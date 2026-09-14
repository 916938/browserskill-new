use bsk::cli::tab::{CliScope, TabSub};
use bsk::{Cli, Command};
use clap::Parser;

#[test]
fn browser_tabs_fixed_contract_and_legacy_mode() {
    let cli = Cli::try_parse_from([
        "bsk",
        "tab",
        "list",
        "--browser-id",
        "edge-exact",
        "--scope",
        "user",
        "--json",
    ])
    .unwrap();
    let Command::Tab(cmd) = cli.command else {
        panic!("tab command")
    };
    let TabSub::List(args) = cmd.sub else {
        panic!("list command")
    };
    assert_eq!(args.browser_id.as_deref(), Some("edge-exact"));
    assert_eq!(args.scope, CliScope::User);
    assert!(args.session.is_none());
    for argv in [
        vec![
            "bsk",
            "tab",
            "select",
            "7",
            "--browser-id",
            "edge-exact",
            "--expected-origin",
            "https://agentrouter.org",
            "--json",
        ],
        vec![
            "bsk",
            "tab",
            "create",
            "https://agentrouter.org",
            "--browser-id",
            "edge-exact",
            "--json",
        ],
        vec!["bsk", "tab", "list", "--session", "s1"],
        vec!["bsk", "tab", "select", "7", "--session", "s1"],
        vec![
            "bsk",
            "tab",
            "create",
            "--session",
            "s1",
            "--url",
            "about:blank",
            "--no-active",
            "--index",
            "1",
        ],
        vec!["bsk", "tab", "create", "--session", "s1"],
    ] {
        Cli::try_parse_from(argv).unwrap();
    }
}

#[test]
fn browser_tabs_rejects_conflicting_or_empty_targets() {
    for command in [
        vec!["list"],
        vec!["select", "7"],
        vec!["create", "https://agentrouter.org"],
    ] {
        for bad in [
            vec![],
            vec!["--browser-id", ""],
            vec!["--browser-id", "  "],
            vec!["--browser-id", "exact", "--session", "s1"],
        ] {
            let mut argv = vec!["bsk", "tab"];
            argv.extend(command.clone());
            argv.extend(bad);
            assert!(Cli::try_parse_from(argv.clone()).is_err(), "{argv:?}");
        }
    }
    for argv in [
        vec![
            "bsk",
            "tab",
            "select",
            "7",
            "--session",
            "s1",
            "--expected-origin",
            "https://site.test",
        ],
        vec![
            "bsk",
            "tab",
            "select",
            "7",
            "--browser-id",
            "exact",
            "--expected-origin",
            "https://site.test/path",
        ],
        vec![
            "bsk",
            "tab",
            "create",
            "https://site.test",
            "--browser-id",
            "exact",
            "--no-active",
        ],
    ] {
        assert!(Cli::try_parse_from(argv.clone()).is_err(), "{argv:?}");
    }
}

#[test]
fn browser_tabs_rejects_invalid_scope_or_url_before_daemon_access() {
    for argv in [
        vec!["bsk", "tab", "list", "--browser-id", "exact"],
        vec![
            "bsk",
            "tab",
            "list",
            "--browser-id",
            "exact",
            "--scope",
            "agent",
        ],
        vec!["bsk", "tab", "create", "--browser-id", "exact"],
        vec![
            "bsk",
            "tab",
            "create",
            "javascript:alert(1)",
            "--browser-id",
            "exact",
        ],
    ] {
        let cli = Cli::try_parse_from(argv).unwrap();
        let Command::Tab(cmd) = cli.command else {
            panic!("tab command")
        };
        assert!(bsk::cli::tab::dispatch(cmd, bsk::cli::error::Format::Json).is_err());
    }
}
