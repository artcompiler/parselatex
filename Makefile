default: lint test

lint:
	npm run lint

test:
	npm run test

update-dependencies:
	rm -f *.tgz || true
	rm -rf node_modules || true
	rm package-lock.json || true
	npm i
	npm pack .

.PHONY: test
