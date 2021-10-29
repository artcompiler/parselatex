default: lint test

lint:
	npm run lint

test:
	npm run test

update-dependencies:
	rm *.tgz
	npm pack .

.PHONY: test
