#!/bin/bash

for i in bluebird web-library; do
  rm -fR ./build/resource/$i
  mkdir ./build/resource/$i
  cp -r ./resource/$i/* ./build/resource/$i/
done

echo Done

