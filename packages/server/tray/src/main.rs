//! Prints `open` or `quit` when chosen from the tray, and exits once stdin closes.
#![windows_subsystem = "windows"]

use std::io::{BufRead, Cursor, Write};

use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon, TrayIconBuilder};

fn main() {
    let open = MenuItem::new("Open editor", true, None);
    let quit = MenuItem::new("Quit", true, None);
    let menu = Menu::with_items(&[&open, &PredefinedMenuItem::separator(), &quit])
        .expect("the menu builds");
    let open = open.id().clone();
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        let choice = if event.id == open { "open" } else { "quit" };
        let _ = writeln!(std::io::stdout(), "{choice}");
    }));
    let tray = TrayIconBuilder::new()
        .with_icon(icon())
        .with_tooltip("Signal Stickers")
        .with_menu(Box::new(menu));
    show_until_stdin_closes(tray);
}

fn icon() -> Icon {
    let mut png = png::Decoder::new(Cursor::new(include_bytes!("../icon.png")))
        .read_info()
        .expect("the icon is a PNG");
    let mut rgba = vec![0; png.output_buffer_size().expect("the icon fits in memory")];
    let frame = png.next_frame(&mut rgba).expect("the icon decodes");
    rgba.truncate(frame.buffer_size());
    Icon::from_rgba(rgba, frame.width, frame.height).expect("the icon is RGBA")
}

fn wait_for_stdin_to_close() {
    for _ in std::io::stdin().lock().lines() {}
}

#[cfg(target_os = "linux")]
fn show_until_stdin_closes(tray: TrayIconBuilder) {
    let _tray = tray.build().expect("the tray icon shows");
    wait_for_stdin_to_close();
}

#[cfg(not(target_os = "linux"))]
fn show_until_stdin_closes(tray: TrayIconBuilder) {
    use tao::event::{Event, StartCause};
    use tao::event_loop::{ControlFlow, EventLoopBuilder};

    let event_loop = EventLoopBuilder::with_user_event().build();
    // Windows menus follow dark mode only in an app with a window.
    #[cfg(windows)]
    let _window = tao::window::WindowBuilder::new()
        .with_visible(false)
        .build(&event_loop)
        .expect("the hidden window opens");
    #[cfg(target_os = "macos")]
    let event_loop = {
        use tao::platform::macos::{ActivationPolicy, EventLoopExtMacOS};
        let mut event_loop = event_loop;
        event_loop.set_activation_policy(ActivationPolicy::Accessory);
        event_loop
    };
    let proxy = event_loop.create_proxy();
    std::thread::spawn(move || {
        wait_for_stdin_to_close();
        let _ = proxy.send_event(());
    });
    let mut tray = Some(tray);
    let mut icon = None;
    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            // macOS shows a tray icon only once its event loop runs.
            Event::NewEvents(StartCause::Init) => {
                icon = tray
                    .take()
                    .map(|tray| tray.build().expect("the tray icon shows"));
            }
            Event::UserEvent(()) => {
                drop(icon.take());
                *control_flow = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}
