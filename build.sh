#!/bin/bash

set +x
docker login -u="$DOCKER_USER" -p="$DOCKER_PASS"
# NODE_ARM=node:6-slim@sha256:8c2f38a142ab2ea936f5445650f75921f097d8e7411e23f514855fba1eafdad1
# NODE_AMD64=node:6-slim@sha256:3887fde264a6d1fd55cc4fd6943c1cd1c304f6a876d414ede35c4887ca1583a5

NODE_ARM=node:8-slim@sha256:285e56773fe02dd2d67015e14e55362879461cf9c7c0078ba88fb5dacecfabc1
NODE_AMD64=node:8-slim@sha256:18b594e73675ca79482ad18d20ba5ac0ac9d3aee220ecf469492c9930272af62

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
