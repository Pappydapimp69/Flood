## Memory: the bs playbooks

This project's memory is the bs playbooks (repo `pappydapimp69/bs`, branch `bs-v4`). Each cloud session wires them in
when it starts (`python3 BS/bs wire`), so the playbooks appear in your skills list and the owner's rules arrive with
every message. Brain is retired: do not run `brain`.

- Flood's own page is `projects/flood.md` in the bs repo, and it is shown when a session starts here. It opens with
  an account of the game written from this code, then the owner's decisions. Work from that page, and keep its
  account current when the code changes how the game works.
- Before you answer, design or build, open the playbook for every subject the task touches, and `testing` for
  anything you build.
- The memory's tool is `python3 <bs repo>/pb`. Use `pb said flood "<the owner's words>"` for a decision about this
  game, `pb fornow "<words>"` for an instruction for this session only, and
  `pb lesson <playbook> "<what>" --repo <this repo> --path <file>` once something works and is committed.
  `pb save` publishes the memory.
