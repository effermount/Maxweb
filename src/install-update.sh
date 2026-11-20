#!/bin/zsh
set -eu
parent_pid="$1"
target="$2"
stage="$3"
work="$4"
log="$5"
exec >>"$log" 2>&1
print 'Waiting for Maxweb to quit'
for iteration in {1..160}; do
  if ! /bin/kill -0 "$parent_pid" 2>/dev/null; then break; fi
  /bin/sleep 0.25
done
if /bin/kill -0 "$parent_pid" 2>/dev/null; then
  print 'Maxweb did not quit; installed application was left untouched'
  exit 1
fi
backup="$work/Previous.app"
/usr/bin/codesign --verify --deep --strict "$stage"
if ! /bin/mv "$target" "$backup"; then
  print 'Cannot move the existing application'
  /usr/bin/open "$target"
  exit 1
fi
if ! /bin/mv "$stage" "$target"; then
  /bin/mv "$backup" "$target"
  /usr/bin/open "$target"
  print 'Replacement failed; original application restored'
  exit 1
fi
if ! /usr/bin/open "$target"; then
  /bin/mv "$target" "$work/Failed.app"
  /bin/mv "$backup" "$target"
  /usr/bin/open "$target"
  print 'Launch failed; original application restored'
  exit 1
fi
print 'Update installed and Maxweb relaunched'
