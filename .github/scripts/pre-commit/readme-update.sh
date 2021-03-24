#!/bin/bash
perl -pi -e "s/JoshPiper\/Changed-Paths-Action\@([\w.]+)?/JoshPiper\/Changed-Paths-Action\@$BUILD_TAG/g" README.md
