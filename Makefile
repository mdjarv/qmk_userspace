.SILENT:

MAKEFLAGS += --no-print-directory

QMK_USERSPACE := $(patsubst %/,%,$(dir $(shell realpath "$(lastword $(MAKEFILE_LIST))")))
ifeq ($(QMK_USERSPACE),)
    QMK_USERSPACE := $(shell pwd)
endif

# Determine which qmk cli to use
QMK_BIN := qmk

# Try to determine qmk_firmware from qmk config - no fallback is required as this functionality has existed since qmk_cli 0.0.46
QMK_FIRMWARE_ROOT = $(shell $(QMK_BIN) env QMK_FIRMWARE)
ifeq ($(QMK_FIRMWARE_ROOT),)
    $(error Cannot determine qmk_firmware location. `qmk config -ro user.qmk_home` or QMK_HOME environment variable is not set)
endif

# Guided backup / restore / flash of the Sofle, see tools/kbflash
# (the keymap's rules.mk sets CONVERT_TO=liatris)
KB ?= splitkb/aurora/sofle_v2/rev1
KM ?= mdjarv
KBFLASH := $(QMK_USERSPACE)/tools/kbflash
FIRMWARE := $(QMK_USERSPACE)/$(subst /,_,$(KB))_$(KM).uf2

.PHONY: backup restore drill build flash

backup:
	$(KBFLASH) backup

restore:
	test -n "$(BACKUP)" || { echo "usage: make restore BACKUP=<backup dir>"; exit 2; }
	$(KBFLASH) restore "$(BACKUP)"

drill:
	$(KBFLASH) drill

build:
	$(QMK_BIN) compile -kb $(KB) -km $(KM)

flash: build
	$(KBFLASH) flash "$(FIRMWARE)" $(if $(ERASE),--erase)

%:
	+$(MAKE) -C $(QMK_FIRMWARE_ROOT) $(MAKECMDGOALS) QMK_USERSPACE=$(QMK_USERSPACE)
