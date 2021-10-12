default: lint test

lint:
	npm run lint

test:
	npm run test

update-dependencies:
	npm pack .

.PHONY: test
