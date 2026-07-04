---
title: "Vs. Coding Agents"
status: "draft"
---

# Don't Coding Agents Abstract Code Already?

LLMs and Coding Agents have upgraded the process of Software Engineering: you can write code at least an order of magnitude faster than you could two years ago.

However, *we still write the same coding languages, we just write them faster*.

In other words: *Coding Agents abstract the _process_ of writing code, they do not abstract code itself*. And sometimes you'll have to help it dig into details.

Logos abstracts the logic itself. As a developer, you think about the product and architecture - you never look at the logic.

Our IDEs and coding interfaces reflect this: many of us still look at `git` diffs while evaluating code.

# Coding Agents Hit Scaling Limits in Practice

Coding Agents today manage up to 1M token context windows. That is *extremely* poor when considering an entire application. It's not just code:
 1. product context
 2. architecture context
 3. team/organizational context
 4. project/timeline context
 5. external context (news, culture)

 We've all felt it:
  1. 2k lines: Coding Agent is *pure magic*
  2. 15k lines: Agent starts to forget things, especially across threads
  3. 50k lines: Agent needs hand-holding
  4. 200k lines: Agent require micro-management and is frustrating to work with

 We are *very* far away from having Coding Agents manage the complexity that humans (or teams of humans) can.

 ## Coding Agents Should Write Logos!

 Logos is a more compact language for Agents to write in. Agents can think about:
  - product behavior
  - architecture
  - etc.

Under the hood, Logos uses Coding Agents, and does so more efficiently due to thoughtful planning, and avoiding unnecessary Agent action.

The result is that, in benchmarking, Logos is around 4-8x shorter to write than raw Python. That makes your 200k line codebase into ~40k lines, unlocking a whole other level of codebase complexity.

# Coding is a Communication Problem

[TODO]

# Memory is the Bad Version of Logos

[TODO]

# Coding Agents are Slower

[TODO] Logos is a compiler: will be smarter
