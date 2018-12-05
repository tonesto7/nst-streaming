FROM ubuntu 

RUN apt-get update && apt-get dist-upgrade -y

RUN apt-get install curl wget build-essential -y
RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -
RUN apt-get install nodejs -y

WORKDIR /app
ADD . /app/

RUN npm install

ENTRYPOINT npm start

EXPOSE 3000
