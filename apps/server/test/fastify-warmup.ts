import Fastify from 'fastify'

// Le premier `Fastify()` d'un processus charge ajv et fast-json-stringify : 250 ms à froid, jusqu'à
// 7 s sous la suite complète. Fait ici, avant chaque fichier de test, ce coût échappe au délai de
// 5 s du premier test qui monte une application (vu sur Renault et MELCloud, liaison du compte).
Fastify()
