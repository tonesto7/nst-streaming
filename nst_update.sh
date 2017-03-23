#/bin/bash

srvc_name="nst-streaming.service"
old_srvc="/etc/systemd/system/nst-streaming.service"
new_srvc="/home/pi/nst-streaming-master/nst-streaming.service"
zip_file="/home/pi/nst-streaming-master.zip"
app_dir="/home/pi/nst-streaming-master"

check_for_update() {
    echo "Checking for Newer file on remote server..."
    remote_file="https://dl.dropboxusercontent.com/s/axr6bi9g73di5px/nst-streaming-master.zip"
    local_file="/home/pi/nst-streaming-master.zip"
    modified=$(curl --silent --head $remote_file |
               awk -F: '/^Last-Modified/ { print $2 }')
    remote_ctime=$(date --date="$modified" +%s)
    local_ctime=$(stat -c %z "$local_file")
    local_ctime=$(date --date="$local_ctime" +%s)
    echo "local file time: $local_ctime"
    echo "remote file time: $remote_ctime"
    if [ $local_ctime -lt $remote_ctime ];
    then
        download_zip
    else
        echo "Your version is the current...Skipping..."
    fi
}

download_zip() {
    echo "Downloading nst-streaming-master.zip..."
    sudo wget -N https://dl.dropboxusercontent.com/s/axr6bi9g73di5px/nst-streaming-master.zip -P /home/pi
    cd /home/p
    sudo unzip -o nst-streaming-master.zip
    cd /home/pi/nst-streaming-master
    sudo npm install
    check_srvc_file
}

check_srvc_file() {
    if [ -d $app_dir ];
    then

        if [ -f $old_srvc ];
        then
            echo "Existing NST Streaming Service File found"
            if [[ ! $old_srvc -ef $new_srvc ]];
            then
                echo "New NST Streaming Service File found. Removing Old Service and Updating!!!"
                remove_srvc
                update_srvc
            else
                echo "Existing NST Streaming Service File is same as downloaded version"
            fi
        else
            echo "Existing NST Streaming Service is Missing..."
            update_srvc
        fi
    fi
}

remove_srvc() {
    echo "Disabling and Removing existing NST Streaming Service File"
    sudo systemctl disable $srvc_name
    sudo rm $old_srvc
}

update_srvc() {
    if [ ! -f "$old_srvc" ];
    then
        echo "Copying Updated NST Streaming Service File to Systemd Folder"
        sudo cp $new_srvc $old_srvc -f

        echo "Reloading Systemd Daemon to reflect service changes..."
        sudo systemctl daemon-reload
        echo "Enabling NST Service..."
        sudo systemctl enable $srvc_name
        echo "Starting up NST Streaming Service..."
        sudo systemctl start $srvc_name
    fi
}

if [ -f "$zip_file" ] || [ ! -f "$old_srvc"];
then
    check_for_update
else
    download_zip
fi
