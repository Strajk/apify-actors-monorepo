# My monorepo of Apify Actors and related tools

*🥸 Beware: This is a living project → it's constantly and drastically changed/updated*

This (mono-)repository contains:

- `actors/` **my actors in my custom mono-file format** – the whole actor in one TypeScript file
- `actors-dist/` compiled/bundled version of the above actors, committed to repo for easy sharing and publishing to Apify platform. All code there is generated.
- `actors-classic/` **my actors in standard format** – one folder per actor, containing logic, Dockerfile, schemas, package.json, ...
- `packages/bundler` my **custom "bundler"** to convert mono-file format actors to the standard format, runnable on Apify platform (and elsewhere, it uses Docker)
- `scripts` **various helper scripts** I use to facilitate development
- `.idea` **WebStorm IDE settings** configured for maximum productivity 🤠

_🤔 What are Actors? Read about it on [official Apify docs](https://apify.com/actors)_

## About "Mono-file actors"

I understand the reasons why we [got rid of](https://blog.apify.com/single-javascript-file-actors-are-being-deprecated/) Single file actors,
but I really miss their simplicity and encapsulation.
That's why I tinkered a similar approach of having a whole actor logic in one file, 
but still compatible with Docker based actors (-> runnable on Apify platform).

### Principles

* **Opinionated**: suited for my needs
* **Focused** on scraping websites: not for general automation. Not for utilities.
* **Pragmatic**: usefulness > academic correctness
* **Not reinventing everything**: Checks in ESLint & Semgrep. Commands in Apify CLI. Code generation in custom bundler. 
* **Remixing** various standards in non-standard ways: Frontmatter in JSDoc. Types in TypeScript. 
* **Continues improvements**: Hack to make it work, improve only when needed

### Structure

```shell
├─ actors
  ├─ _utils                    -> shared utils accross actors
  ├─ foo-actor.ts              -> source file
  ├─ foo-actor.png             -> picture
  ├─ foo-actor.collector.json  -> generated summary of the actor 
├─ actors-dist
  └─ foo-actor                 -> built actor
```

### `/dist` structure – what is generated

```shell
- Dockerfile
- package.json
- README.md
- main.js
- INPUT_SCHEMA.json
- apify.json
```

### Special properties

##### Frontmatter in JSDoc style

Used to generate actor manifest, package.json, Dockerfile, ...

```js
/**
 * @actor.name = "Instagram scraper"
 * @actor.dockerfile = "FROM node:latest"
 * */
```

##### constants Input and Output

Used to generate Input schema and Output schema.

```js
const Input = {
  url: 'string',
  username: 'string',
};

const Output = {
  url: 'string',
  price: 'float',
};
```


### Bundler

* Ideally, I would like to use Deno, TS, Rollup, Webpack, or something similar to generate full actors from single-file definitions. But from quick attempts, it always introduced some limitations. So I decided to use good old JavaScript to brainstorm a prototype and different approaches as it's the most flexible.
* It allows me to do the tweak the bundling to be the most useful, although maybe not the most efficient – which is fine.
