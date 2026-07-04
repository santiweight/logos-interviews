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
