# Why Build a Programming Language + IDE in 2026?

Building a new IDE-PL comes down to a confluence of factors that we will explore in this article:
 1. The market is ignoring PLs as a heatspot in the software development stack, and that means there's easy product wins to be had
 2. IDEs and Agents are not long-term stable strategies for building software development products, and cannot monopolize nor build non-competing businesses
 3. Better products can be built by building better PLs to back UXs for specific niches
 4. Niche products (think: Powerpoint, PDF, Claude Design) *do not compete with generalist programming products*, and lead to *wide moated products that users don't leave*
 4. Non-competitive products are the ultimate goal: if you have a non-generalist product, and a niche market, no amount of AGI will get humans to switch from your product.

 In summary: *If you are able to build a better (proprietary) PL and IDE for your niche, you will destroy Claude in your vertical*, and will *likely have a long-term winning business that isn't extremely painful to maintain advantage in*.

This article will:
 1. explore the current market and players
 2. argue why they're badly positioned at winning the IDE game (note: many will win the AI training game)
 3. describe my personal perspective, and two products I built to motivate
  - Logos: a Natural Language Programming Language
  - Unnamed IDE: an IDE for Product Engineers built on Logos

# Today's IDEs and Agents act like Commodities

The software development stack primarily consists of the following layers:
 1. IDE: the application the human clicks on (e.g. Cursor, VS Code, Powerpoint, Figma UI)
 2. Coding Assistant: the way human interactions change the underlying "code" (e.g. Claude, Codex, Powerpoint engine)
 3. PL: the program that defines what the computer will run
 4. Hardware: how programs are executed

The focus today is set squarely on generalist *coding*IDEs + *Coding Agents*, and typically a mixture of both. The three primary products being focused on are:
 1. IDE + Agent + Model: Cursor + Composer, Zed + Zed Agent
 2. IDE, no agent: VS Code, Conductor
 3. Agent, no IDE: Claude, Codex

These approaches are fundamentally un-sticky:
 - Text-based agents are extremely switchable (you can used Claude + Codex in parallel wihtout issue)
 - IDEs are also fairly switchable (switching from Cursor to Zed took me around 1 hour of pain, maybe less)

## 2026 IDEs not Sticky

IDEs today are largely not taking differentiated opinions on how software development should be different.

Most products look something like:
 - Workspaces on the left
 - Agent view to the right of that
 - File view to the right of that
 - File Tree view somewhere as well

 [INSERT images]

The following products all fall into this:
 1. Zed
 2. Conductor
 3. IntelliJ

 The way to think of these products is "I'm writing code, and now the agent helps me write code quicker".

 These products are, in my opinion, fundamentally limited in their thoughtfulness and scope. They feel like software engineers being forced into agentic coding, not paradigm shifts. As a result, these businesses will adapt and adjust heavily to survive new players. Note: adapting and adjusting are signs of a product just behind the curve, and therefore the sign of a competing product, not a strong market strategy.

### Cursor is Doing Better

 *Cursor notably is taking a mild swing at this*. Cursor is betting that "My new target is not code, but agents, and that my interface for building products is coding agents".

This strategy is basically "if I'm building a product, I only talk to agents to achieve what I want". I think this is a much more thoughtful strategy, but I think this strategy still misses the mark.

The reason is that agent coding is, again, fundamentally switchable. The Cursor agent view is:
 1. workspaces on the left
 2. agent view to the right of that
 3. browser/file view to the right of that

 So while the agent view is a little better, it still ties itself heavily to the agentic coding paradigm. It's fundamentally about making code changes and then viewing the product later.

## Coding Agents are Commodities

This one is fairly simple. Most coding agents are completely commoditized. They have text interfaces, where you type natural language, and then you get back code changes.

These products are completely limited long-term:
 1. the ease of onboarding indicates that they are tragically switchable products, and people use these agents interchangeably and in parallel
   - for example, when I used Cursor, I would use Claude + Codex in parallel, and rarely use Composer
 2. coding agents are generalist, and so therefore will not outlive specialized agents for specific niches

Of course, for these LLM shops (OpenAI, Anthropic), agents are actually just *decent products on top of LLM offerings*. But don't lose sight of the fact that the agent harnesses themselves, and the text interface products on top, will die just as quickly as they were adopted once each vertical gets its targeted product.

# Which Software Development Products Outlasted Historically?

We'll discuss 3 IDE-PL combos that have won long-term, focusing on the IDE->PL stack (note that now the agent in between *could* be a separable product e.g. IDE->agent->PL, though likely shouldn't be):
 1. Powerpoint and `.pptx`
 2. Adobe Acrobat and `.pdf`
 3. IntelliJ and `.java`

 And we'll see that the primary factors for long-lasting IDEs are:
  1. opinionated interfaces
  2. proprietary PLs
  3. niche targets

## Powerpoint and `.pptx`

Powerpoint is such a good IDE, that you don't even realize it is one. It's a click-and-drag interface that lets you create slides however you want to. Primarily, the limitation in your expression is your hands, not the interface, and that is the sign of a genius product.

Powerpoint is so sticky that most decks are now called "PowerPoints".

## Adobe Acrobat and `.pdf`

[COMPLETE]

## IntelliJ and `.java`

[COMPLETE]

## Do Today's Products Stack Up?

The answer, for me, is no. Most of the LLM shops are really just massive hardware infrastructure with a decent coding-agent/IDE on top. Elon + SpaceX bought Cursor not because it would make him write code faster, but because they have the infra for the massive AI infra he'll need to succeed.

So basically, when you're looking at the software development landscape, realize that the products you're looking at *aren't the value proposition*, and so of course the products are *just okay*.

# What's Next for Software Development?

For me, the answer is Product Development: the abstraction of software into product-level thinking. Whereas as we used to have Product Managers designing products that SWEs would implement, we now have Product Engineers or FDEs.

It used to be that:
 - Product Managers used Figma to design products
 - Software Engineers used traditional IDEs + programming languages to implement products' software

 So the old stack was:
  - Figma + [INSERT] -> IDE-PL combo for UI design
  - VS Code + Python/TS -> IDE-PL combo for software implementation

Now the question is: what is the IDE-PL combo for the product engineer?

Some attempted answers are:
 1. Replit + TS
 2. Lovable + TS
 3. Cursor + Python/TS
 4. Zed + Python/TS

Notice: they all just built layers on top of the old stuff!

## What does a Product Engineer want?

PL design is a tale of abstraction, where abstraction lets you stop thinking about details:
 1. C's heap + pointer model let you not think registers
 2. Python's garbage collector let you not think about managing memory and pointers
 3. Rust's ownership model let you not think about memory safety

As a Product Engineer, *I don't want to think about*:
 1. git and code diffs/merges
 2. code and how behavior was implemented
 3. product/codebase stability

 *I do want to think about*:
  2. Product behavior: any change to the product's behavior has to go through me first
   - Change in UI design
   - Change in a user story
   - Change in performance
  1. Architecture: architecture is a product-level concern that I need full control over
  3. Review and QA: I need to be able to review and QA product changes as they come in, and I need to be able to automate the process of capturing tests and running them
  4. Security: I need to have confidence in the security of the product at a glance, without using agents to review the code

Today's software products are fundamentally *terrible* at the above, because they focus on the old *software engineer* paradigm, instead of building a better product for a *product engineer*.

## What IDE does a Product Engineer want?

As a product engineer, I want my IDE to focus on:
 - reviewing architecture-level changes
 - reviewing product-level behavior
 - enabling easy QA and automated testing of user stories

To that end, a product engineer's IDE should look like:
 1. on the left *workspaces*, where I am working on product features/changes in parallel
 2. on the right, a combination of:
   a. the *product* itself - think Browser windows, CLIs
   b. the *architecture* (not the code) - think UML, architecture diagrams, function signatures
   c. *behaviors + tests* - think Playwright, Storybook, tests
   d. the ability to review all of the above as the product changes

 # Building [NAME], Powerpoint for Product Engineers

 In order to build the right stack here, you'll need:
  1. a better PL, targeted for Product Engineering
  2. a better IDE, targeted for Product Engineering workflows

My answer to #1 is Logos, an architecture-level programming language.

My answer to #2 is the IDE on top (name TBD), which I've built but turns out to be the harder part!

# Logos: a Programming Language that abstracts Code

Programming is, fundamentally about taking an intent (normally human generated), and producing instructions for a computer to execute said intent (normally repeatedly).

LLMs and agents have recently enabled humans to specify intent in natural language: human writes intent, LLM/agent build the computer instructions.

Before LLMs: intent -> software engineer -> code -> computer
After LLMs: intent -> human that can type -> LLM/agent -> instructions for computer

The issue is that the translation from intent to agent *is actually a tragically difficult problem*. There are a couple reasons:
 1. text is a very low bandwidth communication medium
 2. humans have a lot more context than they can sanely provide in a chat prompt
 3. LLMs and agents fail to make effective changes past ~50k lines of code

All of these are fundamental limitations: *they are about communication between humans and agents, not about agent ability*.

## Intent Encoding is the Hard Part

How many times have you:
 1. told the agent thing X, and it does it
 2. told another agent Y, and it forgot about X, and you suffered

How many times have you:
 1. told the agent thing X, and checked X
 2. realized, a day later that another agent changed X to X', and now you have to untangle X' back to X

 The reason is because agents are fundamentally *imperative* machines that make you write code of old *faster*.

 The right type of agent would be one that builds a *model of your intent*, and *translates that model into instructions* for the computer.

 So the new model is:

Before LLMs: intent -> software engineer -> code -> computer
After LLMs: intent -> human that can type -> LLM/agent -> instructions for computer
After Logos: intent -> human + agent -> encoded intent -> Logos agent -> instructions for computer

## Logos Features

1. natural language code
2. skills and context as a language primitive
3. knowledge and intent as a primitive
4. native support for videos and images
