Output demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 720
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 60ms

Hide
Type "export TMPDIR=$(mktemp -d) && cd $TMPDIR && export PS1='$ ' && clear"
Enter
Sleep 500ms
Type "alias mda='node /home/lh/code/mda-markdown/apps/cli/dist/cli.js'"
Enter
Sleep 200ms
Type "clear"
Enter
Sleep 300ms
Show

Type "mda demo"
Sleep 800ms
Enter
Sleep 2500ms

Type "cat mda-demo/out/SKILL.md"
Sleep 500ms
Enter
Sleep 3500ms

Type "mda integrity verify mda-demo/out/SKILL.md --target SKILL.md"
Sleep 500ms
Enter
Sleep 2500ms
