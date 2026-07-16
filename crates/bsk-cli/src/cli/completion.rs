//! Shell completion script generation for `bsk` CLI.

use clap::{Args, Subcommand};

#[derive(Debug, Clone, Args)]
pub struct CompletionArgs {
    #[command(subcommand)]
    pub shell: ShellTarget,
}

#[derive(Debug, Clone, Subcommand)]
pub enum ShellTarget {
    /// Generate bash completion script.
    Bash,
    /// Generate zsh completion script.
    Zsh,
    /// Generate fish completion script.
    Fish,
    /// Generate PowerShell completion script.
    PowerShell,
}

pub fn dispatch(args: CompletionArgs) -> Result<(), anyhow::Error> {
    use clap::CommandFactory;
    use clap_complete::generate;

    let mut cli = super::Cli::command();
    match args.shell {
        ShellTarget::Bash => {
            generate(
                clap_complete::Shell::Bash,
                &mut cli,
                "bsk",
                &mut std::io::stdout(),
            );
        }
        ShellTarget::Zsh => {
            generate(
                clap_complete::Shell::Zsh,
                &mut cli,
                "bsk",
                &mut std::io::stdout(),
            );
        }
        ShellTarget::Fish => {
            generate(
                clap_complete::Shell::Fish,
                &mut cli,
                "bsk",
                &mut std::io::stdout(),
            );
        }
        ShellTarget::PowerShell => {
            generate(
                clap_complete::Shell::PowerShell,
                &mut cli,
                "bsk",
                &mut std::io::stdout(),
            );
        }
    }
    Ok(())
}
