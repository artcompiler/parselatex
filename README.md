# ParseLaTeX
A library for parsing LaTeX

#### DESCRIPTION

This module implements a LaTeX parser.

#### BUILD

```
$ make
```

This command will run ESLint linter and Jest tests.

#### INSTALLING

```
$ npm i './parselatex'
```

where `./parselatex` refers to the directory that contains this repo.

#### CALLING

```javascript
import {Parser} from '@artcompiler/parselatex'
const node = Parser.parse('1 + 2');
```
