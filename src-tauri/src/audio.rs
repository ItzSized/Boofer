//! Can the user hear Boofer? Reads the output device of the system: muted or volume at 0 = silent.
//! Asked once per finished task with sounds on (`notify` in lib.rs), never in a loop.

#[cfg(windows)]
pub fn system_muted() -> bool {
    // COM on a short-lived thread of its own: the caller may already be in another COM mode.
    std::thread::spawn(|| unsafe {
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

        let init = CoInitializeEx(None, COINIT_MULTITHREADED);
        let muted = (|| -> windows::core::Result<bool> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            Ok(volume.GetMute()?.as_bool() || volume.GetMasterVolumeLevelScalar()? < 0.01)
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        muted.unwrap_or(false)
    })
    .join()
    .unwrap_or(false)
}

/// PipeWire (`wpctl`), then PulseAudio (`pactl`, also answered by pipewire-pulse).
/// Neither installed, or no answer: not muted, as on Windows when the device can't be read.
#[cfg(target_os = "linux")]
pub fn system_muted() -> bool {
    read_output("wpctl", &["get-volume", "@DEFAULT_AUDIO_SINK@"])
        .map(|out| wpctl_says_silent(&out))
        .or_else(|| read_output("pactl", &["get-sink-mute", "@DEFAULT_SINK@"]).map(|out| pactl_says_muted(&out)))
        .unwrap_or(false)
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn system_muted() -> bool {
    false
}

/// The output of a command that succeeded. `notify` runs on the main thread, so a sound server
/// that doesn't answer is given up on quickly. English, because `pactl` translates its answer.
#[cfg(target_os = "linux")]
fn read_output(program: &str, args: &[&str]) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let mut child = Command::new(program)
        .args(args)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait().ok()? {
            Some(status) if status.success() => {
                let mut out = String::new();
                child.stdout.take()?.read_to_string(&mut out).ok()?;
                return Some(out);
            }
            Some(_) => return None,
            None if start.elapsed() > Duration::from_millis(800) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(10)),
        }
    }
}

/// `Volume: 0.40`, `Volume: 0.40 [MUTED]`, `Volume: 0.00`.
#[cfg(target_os = "linux")]
fn wpctl_says_silent(out: &str) -> bool {
    let volume = out.split_whitespace().nth(1).and_then(|v| v.parse::<f32>().ok());
    out.contains("[MUTED]") || volume.is_some_and(|v| v < 0.01)
}

/// `Mute: yes` or `Mute: no`.
#[cfg(target_os = "linux")]
fn pactl_says_muted(out: &str) -> bool {
    out.trim().strip_prefix("Mute:").is_some_and(|answer| answer.trim() == "yes")
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn wpctl_answers() {
        assert!(wpctl_says_silent("Volume: 0.40 [MUTED]\n"));
        assert!(wpctl_says_silent("Volume: 0.00\n"));
        assert!(!wpctl_says_silent("Volume: 0.40\n"));
        assert!(!wpctl_says_silent(""));
    }

    #[test]
    fn pactl_answers() {
        assert!(pactl_says_muted("Mute: yes\n"));
        assert!(!pactl_says_muted("Mute: no\n"));
        assert!(!pactl_says_muted(""));
    }

    #[test]
    fn a_missing_command_is_not_an_answer() {
        assert_eq!(read_output("boofer-no-such-command", &[]), None);
    }
}
