# Close what you open

A job ends with the browsers, tabs and sessions it opened closed, and a line that counts them (aun-cleanup). Closing is part of the job, so it runs in a finally block, in a hook, and at session end.

## Who closes what

The app owns the browser; the model never closes it (cloudflare/agents). Two parties split the work:

- **The AI** closes the tabs this run opened, before it reports.
- **The host session** closes the rest: the close check blocks a stop once while run-created tabs or browsers are open, and the session sweep closes leftovers at session start, end and on the next prompt.

## Session modes

cloudflare/agents names three ways to hold a browser. Pick one on purpose:

- **One-shot** (the default): open for the job, close at the end. Fits a single read or one form.
- **Reuse**: keep one browser across a short sequence of jobs, with an explicit idle expiry. Close it when the sequence ends.
- **Dynamic**: the number of browsers changes with load. Use it with a cap, and let the sweep reclaim the surplus.

## Own what you start

`lease -- <driver command>` (aun-lease) starts a driver in its own process group, writes an owner file in a private run directory, and gives the run a token tied to its profile path. The owner file is how a later sweep proves a process is yours:

- A leased run closes on exit, on `cleanup`, on session sweep, on the idle timer and on `reap`.
- A sweep on start looks for owner files whose owner is gone and closes what they name.
- A signal goes to the owned group or to the exact verified browser root. Identity comes from the owner file, the process start time and the exact profile path, never from a process name.

For drivers you did not lease, the package matches pinned recipes (executable, profile path pattern, automation flag) and attributes a browser to its host session through the process tree. Anything it cannot prove it owns, `doctor` reports and leaves alone.

## Sweep on a schedule

cloudflare/agents advises calling a connector sweep from a scheduled task. Locally, `reap` is that sweep:

- Every package command runs a quick sweep.
- Session start sweeps leftovers from crashed sessions; each prompt runs a quick idle reap; stop runs one and starts the idle timer; a subagent stop blocks a runner that still owns tabs; session end sweeps the session.
- The idle timer is one detached timer per session. It sleeps to the idle limit, reaps if the session is still idle, and exits by itself. A newer activity stamp cancels it.
- A recurring `reap --idle` from your own scheduler is an opt-in command the installer prints and never writes.

## Idle close and the restart notice

When a browser closes after sitting idle, the next call learns it: the notice says the browser closed after the idle limit and that temporary profile state is gone. cloudflare/agents reports the same fact with a `restarted` flag. Treat it as news: re-open, re-observe, continue.

## The cleanup line

End every run with one line:

`cleanup: browsers=<closed>/<owned> tabs=<closed>/<owned> sessions=<closed>/<owned> remaining=<n> checks=<ps|tabs|api>`

- `checks` names the probes that ran. A probe that could not run prints `UNVERIFIED`, so a zero never hides an unchecked place.
- `remaining` above zero after the grace period makes `cleanup` and `reap` exit 3.

## Check

- CL02: close what this run opened, in finally.
- CL03: throwaway profile deleted; persistent driver profile kept; the user's profile untouched.
- CL04: remote sessions closed by recorded id.
- CL05: `cleanup --session --apply` ran and its exit code was read.
- CL06: nothing left idle past the limit.
