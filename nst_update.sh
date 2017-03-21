#/bin/bash

SRVCFILE="etc/systemd/system/nst-streaming.service"

sudo wget -N https://dl.dropboxusercontent.com/s/axr6bi9g73di5px/nst-streaming-master.zip
sudo unzip -o nst-streaming-master.zip
cd nst-streaming-master

sudo npm install

if [ -f "$SRVCFILE" ];
then
    if [[ $SRVCFILE -ef /home/pi/nst-streaming-master/nst-streaming.service ]];
    then
        echo "Existing NST Streaming Service File is same as downloaded version"
    else
        echo "Disabling and Removing existing NST Streaming Service File"
        sudo systemctl disable nst-streaming.service
        sudo rm "$SRVCFILE"
        if [ ! -f "$SRVCFILE"];
        then
            echo "Copying Updated NST Streaming Service File to Systemd Folder"
            sudo cp /home/pi/nst-streaming-master/nst-streaming.service "$SRVCFILE" -f

            echo "Reloading Systemd Daemon to reflect service changes..."
            sudo systemctl daemon-reload
            sudo systemctl enable nst-streaming.service
            echo "Starting up NST Streaming Service..."
            sudo systemctl start nst-streaming.service
        fi
    fi
fi
