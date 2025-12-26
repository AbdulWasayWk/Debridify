**A stremio extention that uses real debrid and jackett for torrent search and streaming**

ENV file should be like:

> PORT="7000"
> LOG_TO_FILE="true"
> REAL_DEBRID_API_KEY="YOUR_KEY_HERE"
> OMDB_URL="https://www.omdbapi.com"
> OMDB_API_KEY="YOUR_KEY_HERE"
> JACKETT_URL="http://localhost:9117/api/v2.0"
> JACKETT_API_KEY="YOUR_KEY_HERE"

Steps to run:

-
- Set ENVs
- Run `docker-compose up -d jackett` and add the jackett API key to the ENVs
- Start the app by running `docker-compose up -d app`
