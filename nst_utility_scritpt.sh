#!/bin/bash

_user="$USER"
use_sudo=false
local_dir="/home/$_user"
localapp_dir="$local_dir/nst-streaming-master"

zip_name="nst-streaming-master.zip"
local_file="$local_dir/$zip_name"

srvc_name="nst-streaming.service"
new_srvcinstall="/etc/systemd/system/$srvc_name"
new_srvcfile="$localapp_dir/$srvc_name"

old_name="nst-streaming.service"
old_srvcinstall="/etc/systemd/system/$old_name"

remote_file="https://dl.dropboxusercontent.com/s/axr6bi9g73di5px/$zip_name"

check_sudo() {
    if [ -x "$(command -v sudo)" ] || [ $_user != "root" ];
    then
        $use_sudo = "true"
    fi
    echo "Using Sudo: ($use_sudo)"
}

download_install_zip() {
    echo "----------------------------------------------------------------------"
    echo "Downloading Latest NST-Streaming Zip File ($zip_name)"
    echo "----------------------------------------------------------------------"
    if [ $use_sudo == "true" ]; then
        sudo wget -N $remote_file -P $local_dir
    else
        wget -N $remote_file -P $local_dir
    fi

    if [ -f $local_file ];
    then
        stop_old_srvc

        cd $local_dir
        if [ $use_sudo == "true" ]; then
            sudo unzip -o $local_file
        else
            unzip -o $local_file
        fi
        set_owner

        echo "Changing to [$localapp_dir] directory..."
        cd $localapp_dir
        npm install --no-optional

        if [ -f $new_srvcfile ];
        then
            echo "New NST Streaming Service File found. Installing!!!"
            if [ $_user != "pi" ];
            then
                echo "Modifying Service file with Current User Path [$local_dir]"
                if [ $use_sudo == "true" ]; then
                    sudo sed -ia 's|/home/pi/nst-streaming-master|'$localapp_dir'|g' $srvc_name
                else
                    sed -ia 's|/home/pi/nst-streaming-master|'$localapp_dir'|g' $srvc_name
                fi
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
    echo "----------------------------------------------------------------------"
    echo "Checking for Existing NST Streaming Service File"
    if [ -f $old_srvcinstall ];
    then
        echo "Existing Service File Found..."
        echo "Removing Old Service"
        remove_srvc
        echo "----------------------------------------------------------------------"
    else
        echo "Existing Service File Not Found..."
        echo "----------------------------------------------------------------------"
    fi
}

remove_srvc() {
    echo "Disabling and Removing Existing NST Streaming Service"
    if [ $use_sudo == "true" ]; then
        sudo systemctl stop $old_name
        sudo systemctl disable $old_name
        sudo rm $old_srvcinstall
    else
        systemctl stop $old_name
        systemctl disable $old_name
        rm $old_srvcinstall
    fi
}

update_srvc() {
    echo "----------------------------------------------------------------------"
    if [ ! -f "$old_srvcinstall" ]; then
        if [ $use_sudo == "true" ]; then
            echo "Copying Updated NST Streaming Service File to Systemd Folder"
            sudo cp $new_srvcfile $new_srvcinstall -f
            echo "Reloading Systemd Daemon to reflect service changes..."
            sudo systemctl daemon-reload
            echo "Enabling NST Service..."
            sudo systemctl enable $srvc_name
            echo "Starting up NST Streaming Service..."
            sudo systemctl start $srvc_name
        else
            echo "Copying Updated NST Streaming Service File to Systemd Folder"
            cp $new_srvcfile $new_srvcinstall -f
            echo "Reloading Systemd Daemon to reflect service changes..."
            systemctl daemon-reload
            echo "Enabling NST Service..."
            systemctl enable $srvc_name
            echo "Starting up NST Streaming Service..."
            systemctl start $srvc_name
        fi
    else
        echo "Not copying new service as old file is still there..."
        exit 1
    fi
    echo "----------------------------------------------------------------------"
}

install_prereqs() {
    echo "----------------------------------------------------------------------"
    echo "Installing Required Pre-Requisite APT Packages"
    if [ $use_sudo == "true" ]; then
        sudo apt-get update
        sudo apt-get upgrade -f -y --force-yes
        curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash -
        sudo apt-get install wget git-core unzip openssh-server nodejs build-essential -y
    else
        apt-get update
        apt-get upgrade -f -y --force-yes
        curl -sL https://deb.nodesource.com/setup_7.x | bash -
        apt-get install wget git-core unzip openssh-server nodejs build-essential -y
    fi
    echo "----------------------------------------------------------------------"
}

set_owner() {
    echo "Making $_user owner on $local_dir..."
    if [ $use_sudo == "true" ]; then
        sudo chown -R $_user:$_user $local_dir
    else
        chown -R $_user:$_user $local_dir
    fi
}

cleanup() {
    echo "----------------------------------------------------------------------"
    echo "Removing All NST-Streaming Data and Files"
    if [ $use_sudo == "true" ]; then
        sudo rm -rf $localapp_dir
        sudo rm -rf $local_dir/$zip_name
    else
        rm -rf $localapp_dir
        rm -rf $local_dir/$zip_name
    fi
    echo "----------------------------------------------------------------------"
}

uninstall() {
    remove_srvc
    cleanup
}

echo "Executing Script $0 $1"
dir_owner="$(stat -c '%U' $local_dir)"
if [ $_user != $dir_owner ];
then
    check_sudo
    set_owner
fi

if [ "$1" = "-r" ];
then
    check_sudo
    uninstall
    exit
elif [ "$1" = "-f" ];
then
    check_sudo
    echo "Removing $local_file ..."
    if [ $use_sudo == "true" ]; then
        sudo rm -rf $local_file
    else
        rm -rf $local_file
    fi
elif [ "$1" = "-sp" ];
then
    check_sudo
    download_install_zip
elif [ "$1" = "-help" ];
then
    echo " "
    echo "NST Utility Scritpt Help..."
    echo "These are the available arguments:"
    echo "None | This runs the full install process"
    echo "-f   | Forcefully Update Files/Service"
    echo "-r   | Completely Remove Files/Service from System"
    echo "-sp  | Skip Pre-req install and just update existing files"
    echo " "
    exit
else
    check_sudo
    install_prereqs
fi

# if [ -f $local_file ];
# then
    #echo "Checking for Newer file on remote server..."
    # modified=$(curl --silent --head $remote_file |
    #             awk -F: '/^Last-Modified/ { print $2 }')
    # remote_ctime=$(date --date="$modified" +%s)
    # local_ctime=$(stat -c %z "$local_file")
    # local_ctime=$(date --date="$local_ctime" +%s)
    # echo "local file time: $local_ctime"
    # echo "remote file time: $remote_ctime"
    # if [ $local_ctime -lt $remote_ctime ];
    # then
    #     echo "Updating..."
    # else
    #     echo "Your version is the current...Skipping..."
    #     exit
    # fi
# fi
check_sudo
download_install_zip
