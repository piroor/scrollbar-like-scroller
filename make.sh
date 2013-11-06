#!/bin/sh

appname=scrollbar-like-scroller

cp buildscript/makexpi.sh ./
./makexpi.sh -n $appname -o
rm ./makexpi.sh

