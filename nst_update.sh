#/bin/bash

srvc_name="nst-streaming.service"
old_srvc="etc/systemd/system/nst-streaming.service"
new_srvc="/home/pi/nst-streaming-master/nst-streaming.service"

sudo wget -N https://dl.dropboxusercontent.com/s/axr6bi9g73di5px/nst-streaming-master.zip
sudo unzip -o nst-streaming-master.zip
cd nst-streaming-master

sudo npm install

if [ -f "$old_srvc" ];
then
    if [[ "$old_srvc" -ef "$new_srvc" ]];
    then
        echo "Existing NST Streaming Service File is same as downloaded version"
    else
        update_srvc
    fi
fi

update_srvc () {
    echo "Disabling and Removing existing NST Streaming Service File"
    sudo systemctl disable "$srvc_name"
    sudo rm "$old_srvc"
    if [ ! -f "$old_srvc" ];
    then
        echo "Copying Updated NST Streaming Service File to Systemd Folder"
        sudo cp "$new_srvc" "$old_srvc" -f

        echo "Reloading Systemd Daemon to reflect service changes..."
        sudo systemctl daemon-reload
        sudo systemctl enable "$srvc_name"
        echo "Starting up NST Streaming Service..."
        sudo systemctl start "$srvc_name"
    fi
}
