#!/usr/bin/env bash
# Rebuilds dist/gpdf.mjs and dist/gpdf.wasm from GhostPDL at a pinned commit plus patches/.
# Needs: git, make, autoconf, automake, libtool, node, and a host C compiler (HOST_CC).
set -euo pipefail

GHOSTPDL_REPO="${GHOSTPDL_REPO:-https://github.com/ArtifexSoftware/ghostpdl.git}"
GHOSTPDL_COMMIT="51e531d5fc35b04146454a9a14dfb7adea9e4a78"
EMSDK_VERSION="${EMSDK_VERSION:-latest}"
HOST_CC="${HOST_CC:-clang}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$ROOT/.build}"
SRC="$WORK/ghostpdl"
EMSDK="$WORK/emsdk"
JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

mkdir -p "$WORK"

# Emscripten SDK
if [ ! -d "$EMSDK" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$EMSDK"
fi
"$EMSDK/emsdk" install "$EMSDK_VERSION"
"$EMSDK/emsdk" activate "$EMSDK_VERSION"
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh"

# GhostPDL source at the pinned commit, with our patch applied to a clean tree
if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" remote add origin "$GHOSTPDL_REPO"
fi
git -C "$SRC" fetch --depth 1 origin "$GHOSTPDL_COMMIT"
git -C "$SRC" checkout -q -f "$GHOSTPDL_COMMIT"
git -C "$SRC" clean -fdqx
git -C "$SRC" apply "$ROOT/patches/ghostpdl-qfactor.patch"

cd "$SRC"
./autogen.sh > "$WORK/autogen.log" 2>&1
mkdir -p obj

# Type sizes for the target. genarch must be compiled for wasm32, so it is built with emcc
# and run under Node, which writes arch.h with the 64-bit color index that the build expects.
emcc -O1 -sNODERAWFS=1 -DGX_COLOR_INDEX_TYPE="unsigned long long" -Ibase -Iobj base/genarch.c -o "$WORK/genarch.js" > "$WORK/genarch-build.log" 2>&1
# The package is an ES module ("type": "module"), so run the CommonJS copy.
cp "$WORK/genarch.js" "$WORK/genarch.cjs"
node "$WORK/genarch.cjs" "$WORK/arch.h"

printf 'pdfwrite\n' > "$WORK/drivers.txt"
# --host tells configure this is a cross build, so it does not try to run the wasm test programs.
emconfigure ./configure \
  --host=wasm32-unknown-emscripten \
  --with-arch_h="$WORK/arch.h" \
  --with-driversfile="$WORK/drivers.txt" \
  --disable-contrib --disable-fontconfig --disable-dbus --disable-cups --disable-gtk \
  --without-x --without-ijs --without-libpaper --without-pdftoraster --without-libiconv \
  > "$WORK/configure.log" 2>&1

# The Makefile reuses obj/arch.h if it exists, so remove it before building.
rm -f obj/arch.h

# Base-14 fonts only (see README). CMaps, CID substitution and the other base fonts are left out.
PDF_ROMFS_ARGS='-d Resource/ -P $(PSRESDIR)$(D) -C Init$(D)Fontmap.GS Init$(D)cidfmap -B Font$(D)NimbusMonoPS-Regular Font$(D)NimbusMonoPS-Bold Font$(D)NimbusMonoPS-Italic Font$(D)NimbusMonoPS-BoldItalic Font$(D)NimbusSans-Regular Font$(D)NimbusSans-Bold Font$(D)NimbusSans-Italic Font$(D)NimbusSans-BoldItalic Font$(D)NimbusRoman-Regular Font$(D)NimbusRoman-Bold Font$(D)NimbusRoman-Italic Font$(D)NimbusRoman-BoldItalic Font$(D)StandardSymbolsPS Font$(D)D050000L'
PDF_LDFLAGS='-Oz -flto -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createGhostPDF -sFORCE_FILESYSTEM=1 -sEXPORTED_RUNTIME_METHODS=FS -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=0 -sENVIRONMENT=web,worker,node'

emmake make -j"$JOBS" bin/gpdf.mjs XE=.mjs \
  CCAUX="$HOST_CC -std=gnu11" \
  XCFLAGS="-Oz -flto" \
  PDF_ROMFS_ARGS="$PDF_ROMFS_ARGS" \
  PDF_LDFLAGS="$PDF_LDFLAGS" \
  > "$WORK/make.log" 2>&1

mkdir -p "$ROOT/dist"
cp bin/gpdf.mjs bin/gpdf.wasm "$ROOT/dist/"

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi; }
{
  echo "ghostpdl $GHOSTPDL_COMMIT"
  echo "emscripten $(emcc --version | head -1)"
  sha256 "$ROOT/dist/gpdf.wasm"
  sha256 "$ROOT/dist/gpdf.mjs"
} > "$ROOT/dist/BUILD-INFO.txt"

echo "built $ROOT/dist/gpdf.wasm"
