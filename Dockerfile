FROM node:18.12.1-alpine3.16
USER root

WORKDIR /opt/app

COPY . .

RUN apk add --no-cache nmap iproute2
RUN npm install --only=prod

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV

ARG PORT=80
ENV PORT $PORT
EXPOSE $PORT

CMD [ "node", "index.js" ]