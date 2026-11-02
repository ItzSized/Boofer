//! Can the user hear Booffer? Reads the Windows output device: muted or volume at 0 = silent.

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

#[cfg(not(windows))]
pub fn system_muted() -> bool {
    false
}
