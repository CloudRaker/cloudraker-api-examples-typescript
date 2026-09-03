# split-a-packet

One scanned PDF that holds several documents becomes one file per document. Each
child is labelled and extracted. Three calls, no server, on the
[`@cloudraker/api` TypeScript SDK](https://docs.cloudraker.com/paperwork/developers/sdks).

1. [`sdk.classify()`](https://docs.cloudraker.com/paperwork/capabilities/classify) in
   `page` mode labels every page and marks where each document starts. The platform
   derives `segments[]` from those marks. This is the only call that runs a model.
2. [`sdk.split()`](https://docs.cloudraker.com/paperwork/capabilities/split) takes the
   classify run id and cuts the PDF along the segments. No model. Each child is a
   real file with its own id, parsed and ready for any verb.
3. [`sdk.extract()`](https://docs.cloudraker.com/paperwork/capabilities/extract) runs
   once per child, with prose `hints` chosen by the class the child was given.

```sh
bun install
bun app.ts ./packet.pdf
```

Put `RAKERONE_API_KEY=sk_...` in a `.env` beside `app.ts`. PDF only: split fails
other inputs with `unsupported_split_source`.

Edit `CLASSES` in `app.ts` for your own documents. The `description` is the accuracy
lever. The `id` is the key you branch on, and it comes back untouched.
