# Taskwarrior on rn

Taskwarrior is installed manually from the official 3.5.0 release, without Homebrew or the Ubuntu Taskwarrior 2 package.

| Purpose                | Path                                               |
| ---------------------- | -------------------------------------------------- |
| Versioned installation | `/opt/taskwarrior/3.5.0`                           |
| Command wrapper        | `/usr/local/bin/task`                              |
| Timewarrior wrapper    | `/usr/local/bin/timew`                             |
| Configuration          | `/etc/taskwarrior/taskrc`                          |
| Task database          | `/var/lib/taskwarrior`                             |
| Timewarrior database   | `/var/lib/taskwarrior/timewarrior`                 |
| Timewarrior hook       | `/var/lib/taskwarrior/hooks/on-modify.timewarrior` |

Source: [official download](https://taskwarrior.org/download/).

Release archive SHA256:

```text
9ea64b411f8314414f440ec765dfdf5a86c9f6159df47e2f60cff3db6b31157a
```

The release uses CMake and Rust. Its dependency tree requires Rust 1.91.1 despite the INSTALL file listing 1.88.0. Build with one job on rn's small VPS. Temporary Rust, Cargo, source, and build files belong under `/var/tmp`, and should be removed after installation. Keep `install_manifest.txt` inside the versioned installation for precise removal later. Do not install build toolchains into the user's home folder.

The command wrapper defaults `TASKRC` to `/etc/taskwarrior/taskrc`, so terminal use also keeps configuration and data out of the home directory. An explicitly supplied `TASKRC` overrides that default.

```sh
ssh rn 'task list'
```

Aster supplies `TASKRC` itself. `/var/lib/taskwarrior/hooks/on-modify.timewarrior` starts and stops Timewarrior intervals tagged with `uuid:<uuid>` when tasks are started, stopped, or completed. Task and Timewarrior data are private to the SSH account. Verify paths and version when performing a future upgrade.
