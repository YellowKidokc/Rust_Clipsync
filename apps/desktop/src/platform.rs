#[cfg(target_os = "windows")]
mod native {
    use std::{ffi::c_void, path::Path};
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
        },
    };

    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow() as isize }
    }

    pub fn restore(window: isize) -> anyhow::Result<()> {
        anyhow::ensure!(window != 0, "No previous window was active");
        if foreground() != window {
            unsafe { SetForegroundWindow(window as *mut c_void) };
        }
        anyhow::ensure!(
            foreground() == window,
            "The previous window could not be focused"
        );
        Ok(())
    }

    pub fn source_app() -> Option<String> {
        unsafe {
            let mut pid = 0;
            GetWindowThreadProcessId(GetForegroundWindow(), &mut pid);
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                return None;
            }
            let mut buffer = [0u16; 1024];
            let mut length = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
            CloseHandle(process);
            if ok == 0 {
                return None;
            }
            let path = String::from_utf16_lossy(&buffer[..length as usize]);
            Path::new(&path).file_name()?.to_str().map(str::to_owned)
        }
    }

    pub fn sequence() -> Option<u32> {
        Some(unsafe { GetClipboardSequenceNumber() })
    }

    pub fn clear_if_current(expected: u32) -> anyhow::Result<()> {
        unsafe {
            anyhow::ensure!(
                OpenClipboard(std::ptr::null_mut()) != 0,
                "Clipboard is busy"
            );
            let cleared = GetClipboardSequenceNumber() != expected || EmptyClipboard() != 0;
            CloseClipboard();
            anyhow::ensure!(cleared, "Could not clear the secret");
        }
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod native {
    pub fn foreground() -> isize {
        0
    }
    pub fn restore(_: isize) -> anyhow::Result<()> {
        Ok(())
    }
    pub fn source_app() -> Option<String> {
        None
    }
    pub fn sequence() -> Option<u32> {
        None
    }
    pub fn clear_if_current(_: u32) -> anyhow::Result<()> {
        anyhow::bail!("Clipboard sequence numbers are unavailable")
    }
}

pub use native::*;
