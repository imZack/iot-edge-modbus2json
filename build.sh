#!/bin/bash

set +x
docker login -u="$DOCKER_USER" -p="$DOCKER_PASS"
# NODE_ARM=node:6-slim@sha256:8c2f38a142ab2ea936f5445650f75921f097d8e7411e23f514855fba1eafdad1
# NODE_AMD64=node:6-slim@sha256:3887fde264a6d1fd55cc4fd6943c1cd1c304f6a876d414ede35c4887ca1583a5

NODE_ARM=node:8-slim@sha256:640d196d3e665ff47aad79f573489351b624582a85246fdb0358254926252b18
NODE_AMD64=node:8-slim@sha256:4e14187e61d0f659e4d0683980b7a427f4263ae0cfa3bb54e6d205503bef0c4d

set -ex

export IMAGE_NAME=zack/iot-edge-modbus2json
export OS=linux
export VERSION=${TRAVIS_TAG:-$TRAVIS_BRANCH}
if [[ x"$VERSION" = x"master" ]]; then
  VERSION=latest
fi
export DOCKER_ARCH_TAG=$OS-$ARCH-$VERSION

# Pull image by arch
if [[ x"$ARCH" = x"arm" ]]; then
  docker pull "$NODE_ARM"
  docker tag "$NODE_ARM" node:8-slim
elif [[ x"$ARCH" = x"amd64" ]]; then
  docker pull "$NODE_AMD64"
  docker tag "$NODE_AMD64" node:8-slim
fi

# Build
docker build -t "$IMAGE_NAME:$DOCKER_ARCH_TAG" .

# Test
docker run --rm "$IMAGE_NAME:$DOCKER_ARCH_TAG" /bin/echo "I'm good!"

# Push
docker push "$IMAGE_NAME:$DOCKER_ARCH_TAG"

# AMD64 would be the last one been executed
if [[ x"$ARCH" != x"amd64" ]]; then
  exit 0;
fi

# Enable manifest
mkdir -p ~/.docker
echo '{ "experimental": "enabled" }' > ~/.docker/config.json

# Create manifest & push
docker manifest create --amend "$IMAGE_NAME:$VERSION" \
  "$IMAGE_NAME:linux-arm-$VERSION" \
  "$IMAGE_NAME:linux-amd64-$VERSION"

docker manifest annotate --os linux --arch arm \
  "$IMAGE_NAME:$VERSION" "$IMAGE_NAME:linux-arm-$VERSION"

set +x
docker login -u="$DOCKER_USER" -p="$DOCKER_PASS"
set -x

docker -D manifest push "$IMAGE_NAME:$VERSION"
