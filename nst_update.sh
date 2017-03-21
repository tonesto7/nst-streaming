#/bin/bash

srvc_name="nst-streaming.service"
old_srvc="etc/systemd/system/nst-streaming.service"
new_srvc="/home/pi/nst-streaming-master/nst-streaming.service"

check_for_update() {
    remote_file="https://dl.dropboxusercontent.com/s/axr6bi9g73di5px/nst-streaming-master.zip"
    local_file="/home/pi/nst-streaming-master.zip"

    modified=$(curl --silent --head $remote_file |
               awk -F: '/^Last-Modified/ { print $2 }')
    remote_ctime=$(date --date="$modified" +%s)
    local_ctime=$(stat -c %z "$local_file")
    local_ctime=$(date --date="$local_ctime" +%s)

    if [ $local_ctime -lt $remote_ctime ];
    then
        download_zip
    fi
}

download_zip() {
    echo "Downloading nst-streaming-master.zip..."
    sudo wget -N https://dl.dropboxusercontent.com/s/axr6bi9g73di5px/nst-streaming-master.zip -P /home/pi
    sudo unzip -o /home/pi/nst-streaming-master.zip /home/pi/nst-streaming-master
    cd /home/pi/nst-streaming-master
    sudo npm install
    if [ -d "/home/pi/nst-streaming-master" ];
    then
        if [ -f "$old_srvc" ];
        then
            if [[ ! "$old_srvc" -ef "$new_srvc" ]];
            then
                if [ -f "$old_srvc" ];
                then
                    remove_srvc
                fi
                update_srvc
            else
                echo "Existing NST Streaming Service File is same as downloaded version"
            fi
        else
            echo "NST Streaming Service is Missing..."
            update_srvc
        fi
    fi
}

remove_srvc() {
    echo "Disabling and Removing existing NST Streaming Service File"
    sudo systemctl disable "$srvc_name"
    sudo rm "$old_srvc"
}

update_srvc() {
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

if [ -f "/home/pi/nst-streaming-master.zip" ];
then
    check_for_update
else
    download_zip
fi
