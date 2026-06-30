# Abstract

The big winners in the software development market will be *those who integrate the entire IDE-agent-model-PL stack* and build better UX for niche domains, while ensuring that the UX is *actually sticky for humans*.

We look at the history of PLs, at key winners in history, and how to build moats around PLs. We then look at some of today's players and their market positioning, which is overall weak.

Finally, we focus on the future of technical PLs, and where they might be headed.

# Executive Summary

This article explores the software development stack and the market dynamics of major players in each layer of the stack: IDEs, coding agents, and domain-specific languages (e.g. n8n, langgraph).

Most coding agents, such as Anthropic's Claude and OpenAI's Codex, use natural language text and so *are positioned weakly for long-term market success* due to cheap adoption and low stickiness.

IDEs, such as Cursor or Zed are better positioned due to their workflow specialization, and because humans are stickier in visual UXs than chat. 

Vibe-coding applications (e.g. Replit, Lovable) are poorly positioned due to the fact that they are not realistic platforms for the reliable development of applications that funnel serious capital. These applications will be chopped up into niches and specialized agents for domains, or will be redesigned to provide better guarantees and reliability than generic coding agents.

PLs are the under-serviced part of the market, and you can expect to see more players there in the coming years. The players who win will be those who build *markedly different code editing experiences on top of new proprietary PLs*, just like how Microsoft's office suite won in the 90s and 2000s. A new market will also open up for the development of new DSLs and PLs, and the subsequent requirement for new coding agents and models on top of these new PLs.

# The Software Develpment Stack

Software Development composes, approximately, into the following architectural stack:
 1. The IDE, which is what the human looks at and interacts with. Examples: VSCode, Replit, Google Chome, Powerpoint
 2. Coding assistants, which help manipulate the underlying PL. Examples: Claude, the Powerpoint engine
    - Some coding assistants are powered by LLMs, such as today's coding agents
 3. Programming Languages (PLs): the thing that the defines the program that the computer will run.
 4. Hardware: how programs are executed.

 Notably, the key markers for usage on the software stack are legacy and being a better UX. Either you're already being used, or people want to use you.

# A look at Programming Languages in 2026

## History of Programming Languages

Programming Languages (PLs) are a tale of abstraction:
 - Bytecode abstracted electrons on chips
 - Assembly abstracted managing registers
 - C abstracted managing memory locality for (multiple)objects
 - Python abstracted managing pointers + memory management

 Each of these abstractions caused people to be able to accurately express ideas that they could not effectively expressing before: someone kept saying "I keep repeating myself!" or "I wish I didn't have to think about X!"

A successful Programming Language, just like any product, picks out the right abstractions and features that enable programmers to express themselves more clearly than they could before.

Some less-obvious PLs are:
 - Markdown/LaTeX: writing documents in semi-structured text
 - `.pptx`: writing visual slide decks (includes a custom visual editor: Powerpoint)
 - `.xlsx`: defining computational spreadsheets for data analysis

## PLs for Software Engineers have Stalled

Programming Languages have largely stalled past the "generalist" languages of the 90s (Python, Java, JS). The major popular languages since then have been optimizations, not new paradigms:
 - Polishing old languages: Zig/Golang for C; Rust for C++; TS for JS
 - DSLs for niches: Rust for systems + performance; Erlang for parallel programming; Ocaml for functional programming

It is not clear what the next step will be, but today there appear to be few strong voices and players.

## Non-Technical PLs are Under-Serviced

Interfaces are starting to be produced for PLs targeted for non-technical audiences. Notably, the availability of Claude and vibe-coding apps has made apparent the demand for non-technical software development.

However, most applications are fundamentally still oriented around the CodingAgent-TS/Python stack. I don't think we've yet seen a strong take on non-technical PLs that are more than Claude wrappers on the web. Nor an attempt to provide reliability in this area that *actually* allows a non-technical user to deploy dependable software without help.

Notably, some visual programming interfaces, such as n8n, are differentiating themselves in this area, by building purely non-technical interfaces that are WYSIWYG enough to avoid the vibe-coding problem.

We discuss other dynamics in this area later in the article.

 ## The Ground is Shifting

The rise of LLMs and coding agents is causing the ground to shift in the PL area. Notably:
 - Programming Languages *network effects are weakening*, due to the decreasing cost of duplicating libraries across lanaguages
 - Programming Languages are *cheaper to learn*, because agents write in them
 - Codebases are *cheaper to migrate* due to coding agents

 Therefore, the coming years I predict we'll see some shifts:
  1. An increase in development of Programming Languages, due to:
    - a decrease in the cost of developing languages and UXs atop
    - a weakening in PL network effect moats
  2. PLs will lean into natural language and no-code interfaces
  3. PLs will become hyper-specialized to specific domains
  4. A preference for specialized coding UXs over generalist coding agents and interfaces.

# Building PL + Software Moats

## Java and IntelliJ

If you write Java, you use IntelliJ. That's the end of it. And the reason is because IntelliJ in fact has a custom fork of the Java compiler that is more amenable to improved IDE experiences. In other words, IntelliJ was able to build a moat for itself by *building a custom Java that offered a markedly better experience for IDE users*.

Trying out a different IDE won't work, because IntelliJ has specific workflows that work for Java users, and a competing factor for IntelliJ's success is their custom Java compiler under the hood.

## Microsoft and Powerpoint

Powerpoint was one of the first IDEs used by non-technical users. It supports a no-code interface, and under the hood utilizes the `.pptx` PL.

Microsoft was able to retain a monopoly on the Powerpoint language due to the proprietary `.pptx` file format, and the fact that they owned changes to the `.pptx` file format. They were able to execute similar monopolies over other IDE-PL combos, notably: Word + `.docx`, and Excel + `.xls`.

Since the Powerpoint application is a *specialized* IDE for creating the Powerpoint format, the product stickiness was massive, and trying competing IDEs was not sustainable or possible.

## PDF and Adobe

Everyone uses PDF. So why can't I edit my PDFs. The reason is because Adobe owns the PDF format, and so Adobe therefore has the best IDE for PDFs (Adobe Acrobat). Things will likely improve now that the cost of developing a new IDE is cheaper, but as long as Adobe owns the format, you can expect them to keep a strangehold on the market.

## Takeaways

Doing the following will help you build a software experience that lasts:
 - Owning the language means you own the stack. No one can build a pdf viewer because Adobe will f*** them.
 - IDEs are not enough: if you don't own the language, you're a commodity
 - Switching costs are your friend: keep your workflows opinionated and specific
 - Niche languages outlast generalists

# Positioning of Major Players

Let's look at some major players today in the software development world and how they stack up.

## Weak: Generalist Coding Agents (Claude, Codex)

Fundamentally, the weakest coding UXs right now are the generalist coding agents, such as Claude and Codex. These agents are completely interchangeable and have no moat:
 - I and many others use these harnesses interchangeably
 - Most popular agents have generalizes apis that allow them to be embedded in IDEs such as VSCode or Zed

Of course, the *data* and *training infrastructure* moats under the hood are a totally different story, but I am not qualified to comment on those moats.

## Okay: Vibe-coding Apps (Replit, Lovable, Base44)

These applications are not yet able to differentiate themselves other than on a technical and experience level. Their primary differentiators are the speed of iteration and ease of use (web-based) versus CLI agents or IDEs.

However, due to their chat-based nature, these applications will inevitably fail to retain consumers as the market settles towards tighter niches. If I'm building my new shopping app, I'll use a tightened shopping-app agent, instead of the generalist and flaky agent supported by Replit.

Similarly, prices will be driven down by the nature of these competitive ecosystems: the ease of access for a new player is extremely high.

## Okay: Integrated Coding Agents (Cursor, Zed)

Agent-integrated IDEs are better positioned by targeting has a custom agent that is integrated into the IDE. Let's explore Cursor:
 1. Cursor (though built on top of VSCode) is tailored to Cursor-specific workflows and is hard to switch off of
 2. Cursor has a tighter feedback loop and interactivity UX, that is markedly different from CLI agents

 However, Cursor has some notable weaknesses.

 ## Strong: Visual/No-Code IDEs on proprietary languages (n8n, [INSERT])

The underlying belief of this article is that, in an agentic world, the stickiest part of the market is *the humans that get addicted and used to a specific experience*.

As a result, making your UX workflow tailored to your specific application domain is going to be where your differentiator and moat are.

PL editing environments and visual/No-Code IDEs are therefore the strongest-positioned for sticky capital that outlasts a vibe-coded competitor.

# Wrap-Up

## Takeaways

1. Text-based coding agents are a commodity unless you have a serious specialization or infrastructure moat that causes you to win in terms of quality
2. Generalist


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
