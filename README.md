# Nest REST Streaming API Sample

Sample app showcasing Nest's REST Streaming API using Node.js

## Screenshot

![Screenshot](screenshot.png)

## Install

Install the dependencies from npm:

```sh
npm install
```

Log in to https://developer.nest.com/products

Create a client using the following permissions:

- Away read v2
- Camera read v2
- Camera read + images v2*
- Smoke+CO alarm read v4
- Thermostat read v4

**Note: Images are only available with a [Nest Aware][nest-aware] subscription.*

Set your client redirect URI to be `http://localhost:3000/auth/nest/callback`

Set up your Nest credentials in your environment variables:

```sh
export NEST_ID=XXX
export NEST_SECRET=XXX
```

## Start

Start the server:

```sh
npm start
```

Open your browser to [http://localhost:3000](http://localhost:3000)

### Server Only Mode

By default the app runs in a server-client mode with a browser UI.
You can also run the app in **server-only** mode (still requires a browser for initial OAuth2 flow).

Start in server-only mode:

```sh
npm run server-only
```

The events will then be logged to the node console rather than displayed in a browser UI.

## Contributing

We love contributions! :smile: Please follow the steps in [CONTRIBUTING][contributing] to get started. If you found a bug, please file it [here][bugs].

## License

Licensed under the Apache 2.0 license. See [LICENSE][license] for details.

[nest-aware]: https://nest.com/support/article/What-do-I-get-with-Nest-Aware-for-Nest-Cam
[nest-sim]: https://developer.nest.com/documentation/cloud/home-simulator/
[bugs]: https://github.com/nestlabs/rest-streaming/issues
[license]: LICENSE
[contributing]: CONTRIBUTING.md
