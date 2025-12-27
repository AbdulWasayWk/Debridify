**A stremio extention that uses real debrid and jackett for torrent search and streaming**

The Production ENVs should be like so:
(The production ENV file name will be .env.docker)

> PORT="7000"
> LOG_TO_FILE="false"
> REAL_DEBRID_API_KEY="YOUR_KEY_HERE"
> OMDB_URL="https://www.omdbapi.com"
> OMDB_API_KEY="YOUR_KEY_HERE"
> JACKETT_URL="http://jackett:9117/api/v2.0"
> JACKETT_API_KEY="YOUR_KEY_HERE"

If you want to run the app in development environment, The DEV ENVs should be like so:
(The development ENV file name will be .env)

> PORT="7000"
> LOG_TO_FILE="false"
> REAL_DEBRID_API_KEY="YOUR_KEY_HERE"
> OMDB_URL="https://www.omdbapi.com"
> OMDB_API_KEY="YOUR_KEY_HERE"
> JACKETT_URL="http://localhost:9117/api/v2.0"
> JACKETT_API_KEY="YOUR_KEY_HERE"

Use the `npm start` commant to run in development environment

Steps to run:

- Set ENVs
- Run `docker-compose up -d jackett` and add the jackett API key to the ENVs
- Start the app by running `docker-compose up -d app`
- Run `docker-compose build app` to rebuild the app then run `docker-compose up -d app` to restart it
