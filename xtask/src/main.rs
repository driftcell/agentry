use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result, bail};

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("build-web") => build_web(),
        Some("check") => check(),
        Some(other) => bail!("unknown xtask {other:?}; expected build-web or check"),
        None => {
            println!("usage: cargo xtask <build-web|check>");
            Ok(())
        }
    }
}

fn repo_root() -> Result<PathBuf> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("xtask manifest has no parent"))
}

fn run(command: &str, args: &[&str], cwd: &PathBuf) -> Result<()> {
    println!("$ (cd {} && {command} {})", cwd.display(), args.join(" "));
    let status = Command::new(command)
        .args(args)
        .current_dir(cwd)
        .status()
        .with_context(|| format!("spawn {command}"))?;
    if !status.success() {
        bail!("{command} {} failed with {status}", args.join(" "));
    }
    Ok(())
}

fn build_web() -> Result<()> {
    let root = repo_root()?;
    let web = root.join("web");
    if !web.join("package.json").exists() {
        bail!("web/package.json is missing; the web skeleton must exist before build-web");
    }
    run("bun", &["install"], &web)?;
    run("bun", &["run", "build"], &web)?;
    let static_dir = root.join("crates/server/static");
    if !static_dir.join("index.html").exists() {
        bail!(
            "web build did not produce {}",
            static_dir.join("index.html").display()
        );
    }
    println!("SPA written to {}", static_dir.display());
    Ok(())
}

fn check() -> Result<()> {
    let root = repo_root()?;
    run("cargo", &["fmt", "--check"], &root)?;
    run("cargo", &["clippy", "--all-targets", "--", "-D", "warnings"], &root)?;
    run("cargo", &["test"], &root)?;
    Ok(())
}
