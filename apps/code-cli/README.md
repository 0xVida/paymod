# Paymod Code

A pay-as-you-go coding agent for the terminal. It reads, edits, runs and
tests your real project locally, using OpenAI or Anthropic models through
Paymod's metered inference proxy (or your own API key).

## Install

```sh
npm install -g @paymod/code-cli
```

## Usage

```sh
paymod-code login              # sign in once
paymod-code                    # start an interactive session in the current directory
paymod-code -p "fix the failing test in src/foo.test.ts"   # run one prompt non-interactively and exit
paymod-code --continue         # resume the most recent session for this project
paymod-code --resume <id>      # resume a specific session by id
paymod-code logout
```

Sessions are local to the project directory they were started in.
