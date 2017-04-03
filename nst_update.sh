#!/bin/bash

THEUSER="$USER"
local_dir="/home/$THEUSER"
localapp_dir="$local_dir/nst-streaming-master"

zip_name="nst-streaming-master.zip"
local_file="$local_dir/$zip_name"

srvc_name="nst-streaming.service"
new_srvcinstall="/etc/systemd/system/$srvc_name"
new_srvcfile="$localapp_dir/$srvc_name"

old_name="nst-streaming.service"
old_srvcinstall="/etc/systemd/system/$old_name"

remote_file="https://dl.dropboxusercontent.com/s/axr6bi9g73di5px/$zip_name"

download_install_zip() {
    echo "Downloading $zip_name..."
    wget -N $remote_file -P $local_dir

    if [ -f $local_file ];
    then
        stop_old_srvc

        cd $local_dir
        unzip -o $local_file
        set_owner

        echo "Changing to $localapp_dir directory..."
        cd $localapp_dir
        npm install --no-optional

        if [ -f $new_srvcfile ];
        then
            echo "New NST Streaming Service File found. Installing!!!"
            if [ $THEUSER != "pi" ];
            then
                echo "Updating Service file with current user $THEUSER"
                sed -ia 's|/home/pi|/home/$THEUSER|g' $srvc_name
            fi
            update_srvc
        else
            echo "New NST Service file not present..."
            exit 1
        fi

    else
        echo "Zip file not present..."
        exit 1
    fi
}

stop_old_srvc() {
    if [ -f $old_srvcinstall ];
    then
        echo "Existing NST Streaming Service File found"
        echo "Removing Old Service"
        remove_srvc
    else
        echo "Existing NST Streaming Service not present..."
    fi
}

remove_srvc() {
    echo "Disabling and Removing existing NST Streaming Service File"
    sudo systemctl stop $old_name
    sudo systemctl disable $old_name
    sudo rm $old_srvcinstall
}

update_srvc() {
    if [ ! -f "$old_srvcinstall" ];
    then
        echo "Copying Updated NST Streaming Service File to Systemd Folder"
        sudo cp $new_srvcfile $new_srvcinstall -f

        echo "Reloading Systemd Daemon to reflect service changes..."
        sudo systemctl daemon-reload
        echo "Enabling NST Service..."
        sudo systemctl enable $srvc_name
        echo "Starting up NST Streaming Service..."
        sudo systemctl start $srvc_name
    else
        echo "Not copying new service as old file is still there..."
        exit 1
    fi
}

set_owner() {
    echo "Making $THEUSER owner on $local_dir..."
    sudo chown -R $THEUSER:$THEUSER $local_dir
}

cleanup() {
    echo "Removing NST-Streaming files"
    rm -rf $localapp_dir
    rm -rf $local_dir/$zip_name
}

uninstall() {
    remove_srvc
    cleanup
}

echo "Executing Script $0 $1"
dir_owner="$(stat -c '%U' $local_dir)"
if [ $THEUSER != $dir_owner ];
then
    set_owner
fi

if [ "$1" = "-r" ];
then
    uninstall
    exit
elif [ "$1" = "-f" ];
then
    echo "Removing $local_file ..."
    rm -rf $local_file
elif [ "$1" = "-help" ];
then
    echo " "
    echo "nst-update help..."
    echo "These are the available arguments:"
    echo "No Arg | This runs the full update process"
    echo "-f  | Forcefully Update Files/Service"
    echo "-r  | Completely Remove Files/Service from System"
    echo "-sp | Skip Pre-req install and just update existing files"
    echo " "
    exit
fi

if [ -f $local_file ];
then
    echo "Checking for Newer file on remote server..."
    modified=$(curl --silent --head $remote_file |
               awk -F: '/^Last-Modified/ { print $2 }')
    remote_ctime=$(date --date="$modified" +%s)
    local_ctime=$(stat -c %z "$local_file")
    local_ctime=$(date --date="$local_ctime" +%s)
    echo "local file time: $local_ctime"
    echo "remote file time: $remote_ctime"
    if [ $local_ctime -lt $remote_ctime ];
    then
        echo "Updating..."
    else
        echo "Your version is the current...Skipping..."
        exit
    fi
fi

download_install_zip
