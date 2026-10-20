import Fastify from 'fastify'

// The first `Fastify()` of a process loads ajv and fast-json-stringify: 250 ms cold, up to 7 s
// under the full suite. Done here, before each test file, that cost escapes the 5 s timeout of the
// first test that mounts an app (seen on Renault and MELCloud, account linking).
Fastify()
