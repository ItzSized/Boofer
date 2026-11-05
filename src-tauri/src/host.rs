//! The host's programs, started from Boofer. In an AppImage the environment points into the
//! bundle (its libraries, GTK and GStreamer modules) and main.rs forces settings meant for
//! Boofer's own window: neither must reach a program of the user's.

use std::process::Command;

#[cfg(not(target_os = "linux"))]
#[cfg_attr(windows, allow(dead_code))]
pub fn command(program: &str) -> Command {
    Command::new(program)
}

#[cfg(target_os = "linux")]
pub fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.env_clear().envs(host_env(std::env::vars_os(), bundle_dir().as_deref()));
    cmd
}

/// Whether the host has this program, looked for without running it. The bundle's folders
/// don't count: what started from a terminal sees none of them.
#[cfg(target_os = "linux")]
pub fn has_program(name: &str) -> bool {
    on_host_path(std::env::vars_os(), bundle_dir().as_deref(), name)
}

#[cfg(target_os = "linux")]
fn on_host_path(
    vars: impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
    bundle: Option<&std::path::Path>,
    name: &str,
) -> bool {
    host_env(vars, bundle).find(|(key, _)| key == "PATH").is_some_and(|(_, path)| found_in(&path, name))
}

/// The AppImage we run from. An APPDIR inherited from another application doesn't count.
#[cfg(target_os = "linux")]
fn bundle_dir() -> Option<std::path::PathBuf> {
    let appdir = std::path::PathBuf::from(std::env::var_os("APPDIR")?);
    let exe = std::env::current_exe().ok()?;
    // current_exe is the real path, APPDIR may go through a link (/tmp on some systems).
    let real = std::fs::canonicalize(&appdir).unwrap_or_else(|_| appdir.clone());
    (runs_from(&appdir, &exe) || runs_from(&real, &exe)).then_some(appdir)
}

/// An empty or relative APPDIR, or "/", would hold every path.
#[cfg(target_os = "linux")]
fn runs_from(appdir: &std::path::Path, exe: &std::path::Path) -> bool {
    appdir.is_absolute() && appdir.parent().is_some() && exe.starts_with(appdir)
}

/// The environment for a program of the host: no entry inside the bundle, and nothing of what
/// main.rs sets for Boofer's own window.
#[cfg(target_os = "linux")]
fn host_env<'a>(
    vars: impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)> + 'a,
    bundle: Option<&'a std::path::Path>,
) -> impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)> + 'a {
    vars.filter(|(key, _)| key != "GDK_BACKEND" && key != "WEBKIT_DISABLE_DMABUF_RENDERER")
        .filter_map(move |(key, value)| match bundle {
            Some(bundle) => Some((key, without_bundle(value, bundle)?)),
            None => Some((key, value)),
        })
}

/// A list of paths without its entries inside the bundle, None when nothing is left. A value
/// with no such entry stays as it is, whatever it holds (DISPLAY=:0). Once rewritten, no empty
/// entry either: AppRun's "$APPDIR/usr/lib:$LD_LIBRARY_PATH" ends with one when the variable
/// was unset, and it would mean the current folder.
#[cfg(target_os = "linux")]
fn without_bundle(value: std::ffi::OsString, bundle: &std::path::Path) -> Option<std::ffi::OsString> {
    let entries: Vec<_> = std::env::split_paths(&value).collect();
    if !entries.iter().any(|entry| entry.starts_with(bundle)) {
        return Some(value);
    }
    let kept: Vec<_> = entries
        .iter()
        .filter(|entry| !entry.starts_with(bundle))
        .filter(|entry| !entry.as_os_str().is_empty())
        .collect();
    if kept.is_empty() {
        return None;
    }
    std::env::join_paths(kept).ok()
}

/// An executable file of that name in one of the folders of a PATH.
#[cfg(target_os = "linux")]
fn found_in(path: &std::ffi::OsStr, name: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::env::split_paths(path).any(|dir| {
        std::fs::metadata(dir.join(name)).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
    })
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::settings::tests::TempDir;
    use std::ffi::OsString;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    const BUNDLE: &str = "/tmp/.mount_Boofer";

    fn clean(vars: &[(&str, &str)], bundle: Option<&str>) -> Vec<(String, String)> {
        let vars = vars.iter().map(|(k, v)| (OsString::from(k), OsString::from(v)));
        host_env(vars, bundle.map(Path::new))
            .map(|(k, v)| (k.into_string().unwrap(), v.into_string().unwrap()))
            .collect()
    }

    fn one(key: &str, value: &str) -> Vec<(String, String)> {
        vec![(key.to_string(), value.to_string())]
    }

    #[test]
    fn library_path_keeps_the_host_entries() {
        let value = format!("{BUNDLE}/usr/lib:/opt/lib:{BUNDLE}/lib/x86_64:/usr/local/lib");
        assert_eq!(
            clean(&[("LD_LIBRARY_PATH", value.as_str())], Some(BUNDLE)),
            one("LD_LIBRARY_PATH", "/opt/lib:/usr/local/lib")
        );
    }

    #[test]
    fn path_keeps_the_host_entries() {
        let value = format!("{BUNDLE}/usr/bin:/home/me/.local/bin:/usr/bin:/bin");
        assert_eq!(clean(&[("PATH", value.as_str())], Some(BUNDLE)), one("PATH", "/home/me/.local/bin:/usr/bin:/bin"));
    }

    #[test]
    fn a_variable_only_inside_the_bundle_goes_away() {
        let single = format!("{BUNDLE}/usr/lib/gio/modules");
        assert!(clean(&[("GIO_MODULE_DIR", single.as_str())], Some(BUNDLE)).is_empty());
        let many = format!("{BUNDLE}/a:{BUNDLE}/b");
        assert!(clean(&[("GTK_PATH", many.as_str())], Some(BUNDLE)).is_empty());
        assert!(clean(&[("APPDIR", BUNDLE)], Some(BUNDLE)).is_empty());
    }

    #[test]
    fn the_empty_entry_left_by_apprun_goes_too() {
        let unset = format!("{BUNDLE}/usr/lib:");
        assert!(clean(&[("LD_LIBRARY_PATH", unset.as_str())], Some(BUNDLE)).is_empty());
        let host = format!("{BUNDLE}/usr/lib::/opt/lib");
        assert_eq!(clean(&[("LD_LIBRARY_PATH", host.as_str())], Some(BUNDLE)), one("LD_LIBRARY_PATH", "/opt/lib"));
    }

    #[test]
    fn other_variables_stay_as_they_are() {
        for (key, value) in [("DISPLAY", ":0"), ("HOME", "/home/me"), ("GREP", "a::b"), ("EMPTY", "")] {
            assert_eq!(clean(&[(key, value)], Some(BUNDLE)), one(key, value));
        }
    }

    #[test]
    fn a_folder_with_the_same_start_isnt_the_bundle() {
        let value = format!("{BUNDLE}2/lib");
        assert_eq!(clean(&[("LD_LIBRARY_PATH", value.as_str())], Some(BUNDLE)), one("LD_LIBRARY_PATH", &value));
    }

    #[test]
    fn without_a_bundle_only_the_window_settings_go() {
        let value = format!("{BUNDLE}/usr/lib");
        let vars = [("GDK_BACKEND", "x11"), ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"), ("LD_LIBRARY_PATH", value.as_str())];
        assert_eq!(clean(&vars, None), one("LD_LIBRARY_PATH", &value));
        assert!(clean(&vars[..2], Some(BUNDLE)).is_empty());
    }

    #[test]
    fn only_a_real_appdir_above_the_program_counts() {
        let exe = Path::new("/tmp/.mount_Boofer/usr/bin/boofer");
        assert!(runs_from(Path::new("/tmp/.mount_Boofer"), exe));
        assert!(!runs_from(Path::new("/tmp/.mount_Other"), exe));
        assert!(!runs_from(Path::new("/tmp/.mount_Boof"), exe));
        assert!(!runs_from(Path::new(""), exe));
        assert!(!runs_from(Path::new("/"), exe));
        assert!(!runs_from(Path::new("tmp"), Path::new("tmp/boofer")));
    }

    #[test]
    fn a_started_program_gets_the_clean_environment() {
        let printed = |cmd: &mut Command| String::from_utf8(cmd.output().unwrap().stdout).unwrap();
        let exe = std::env::current_exe().unwrap();
        let bundle = exe.parent().unwrap();
        let inside = bundle.join("lib");
        std::env::set_var("BOOFER_TEST_INSIDE", &inside);
        std::env::set_var("GDK_BACKEND", "x11");

        // An APPDIR inherited from another application: its paths are left alone.
        std::env::set_var("APPDIR", "/opt/another-app");
        let inherited = printed(&mut command("env"));
        assert!(inherited.contains("BOOFER_TEST_INSIDE="), "{inherited}");
        assert!(inherited.contains("APPDIR=/opt/another-app"), "{inherited}");
        assert!(!inherited.contains("GDK_BACKEND="), "{inherited}");

        std::env::set_var("APPDIR", bundle);
        let ours = printed(&mut command("env"));
        assert!(ours.contains("PATH="), "{ours}");
        assert!(!ours.contains("BOOFER_TEST_INSIDE="), "{ours}");

        // The same bundle through a link: current_exe gives the real path.
        let dir = TempDir::new("host-link");
        let link = dir.0.join("link");
        std::os::unix::fs::symlink(bundle, &link).unwrap();
        std::env::set_var("APPDIR", &link);
        std::env::set_var("BOOFER_TEST_INSIDE", link.join("lib"));
        let linked = printed(&mut command("env"));
        assert!(!linked.contains("BOOFER_TEST_INSIDE="), "{linked}");

        std::env::remove_var("APPDIR");
        std::env::remove_var("BOOFER_TEST_INSIDE");
        std::env::remove_var("GDK_BACKEND");
    }

    #[test]
    fn a_program_inside_the_bundle_isnt_the_hosts() {
        let dir = TempDir::new("host-bundled");
        let bin = dir.0.join("usr").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("curl"), "").unwrap();
        std::fs::set_permissions(bin.join("curl"), std::fs::Permissions::from_mode(0o755)).unwrap();
        let vars = || std::iter::once((OsString::from("PATH"), bin.clone().into_os_string()));
        assert!(!on_host_path(vars(), Some(&dir.0), "curl"));
        assert!(on_host_path(vars(), None, "curl"));
    }

    #[test]
    fn looks_for_a_program_on_the_real_path() {
        assert!(has_program("env"));
        assert!(!has_program("boofer-no-such-program"));
    }

    #[test]
    fn finds_only_an_executable_file_on_the_path() {
        let dir = TempDir::new("host-path");
        let (plain, bin, folder) = (dir.0.join("plain"), dir.0.join("bin"), dir.0.join("folder"));
        for sub in [&plain, &bin, &folder] {
            std::fs::create_dir_all(sub).unwrap();
        }
        std::fs::create_dir_all(folder.join("curl")).unwrap();
        std::fs::write(plain.join("curl"), "").unwrap();
        std::fs::write(bin.join("curl"), "").unwrap();
        std::fs::set_permissions(bin.join("curl"), std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(plain.join("curl"), std::fs::Permissions::from_mode(0o644)).unwrap();

        let path = |dirs: &[&Path]| std::env::join_paths(dirs).unwrap();
        assert!(found_in(&path(&[plain.as_path(), bin.as_path()]), "curl"));
        assert!(!found_in(&path(&[plain.as_path(), folder.as_path()]), "curl"));
        assert!(!found_in(&path(&[dir.0.as_path()]), "curl"));
        assert!(!found_in(std::ffi::OsStr::new(""), "curl"));
    }
}
