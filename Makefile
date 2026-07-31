.PHONY: setup build release firmware test cad cad-openscad browser validate check serve deploy clean

setup:
	python3 scripts/setup_project.py

build:
	python3 scripts/build_webui.py

release: build
	python3 scripts/prepare_controller_bundle.py

firmware:
	python3 scripts/install_fluidnc.py

test:
	node --test tests/core.test.mjs

cad:
	python3 scripts/validate_cad.py

cad-openscad:
	python3 scripts/validate_cad.py --strict --render-all

browser: build
	python3 tests/browser_smoke.py

validate:
	python3 scripts/validate_repository.py

check: test build cad validate

serve:
	python3 scripts/serve_webui.py

deploy:
	@echo "Использование: python3 scripts/deploy_webui.py <адрес ESP32> [--with-config]"

clean:
	rm -rf release build
	rm -f dist/index.html dist/index.html.gz dist/manifest.json dist/browser-smoke.png
