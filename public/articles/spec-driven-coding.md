---
title: "Vs. Spec-Driven Development?"
---

# Why not Spec-Driven Coding?

Abstractions, by definition, are declarative. If Python forced you to call "clean up memory" every five minutes, it would not be an abstraction.

If you look closely at today's spec-driven development options:

- codeplain
- kiro
- ossature
- [TODO]
- etc.

You'll find that these frameworks fall into two camps:

1. *Agent-orchestration frameworks* (Kiro)
2. *Non-rigorous programming languages* that will not scale to production workload scales, and certainly do not represent an abstraction step (Codeplain, Ossature)

How can you tell? Some notable features:

1. *Some frameworks (Kiro) are just coding-agent orchestration frameworks*. You have to click "do this; do that". Imagine if you had to remind your programming language to "compile this function; compile that function".
2. *Most languages use unstructured natural text or Markdown*. While natural language is not a terrible format inherently, today's agents are not yet capable of reliably compiling natural text. Furthermore, natural language does not scale structurally to real production codebases. How will you rename the name of a concept? How will you support multi-platform compilation? Structure is critical for scalable, reliable abstractions.
3. All frameworks drop types. Types are a *fundamental* part of abstraction. Types are not "good practice": they represent the expression of structure. *Types make your user's workflows feel reliable and predictable*. *Types mean that you can have multiple teams working on the same codebase*.
