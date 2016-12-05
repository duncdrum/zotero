#!/bin/bash

CLIENT=$(ls /media/storage/zotero-data/translators/*.js)

OLDIFS="$IFS"
IFS="
"
for i in $CLIENT; do
  FN=$(echo $i | sed -e "s/.*\///")
  cat $i | sed -e "/{/,/}/d" > TEMP1
  cat "./translators/$FN" | sed -e "/^{/,/^}/d" > TEMP2
  diff --brief ./TEMP1 ./TEMP2
done
