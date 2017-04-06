#!/bin/bash

# ---------------------------------GLOBAL VARIABLES--------------------------------------
_scriptVer="0.1"
_useSudo="false"

_currentUser="$USER"

_userDir="/home/$_currentUser"
working_app_dir="$_userDir/nst-streaming-master"

src_zip_name="nst-streaming-master.zip"
app_zip_file="$_userDir/$src_zip_name"

cur_srvc_name="nst-streaming.service"
new_srvc_src_path="$working_app_dir/$cur_srvc_name"
new_srvc_dest_path="/etc/systemd/system/$cur_srvc_name"

old_srvc_name="nst-streaming.service"
old_srvc_path="/etc/systemd/system/$old_srvc_name"

remote_file="https://dl.dropboxusercontent.com/s/axr6bi9g73di5px/$src_zip_name"
# ----------------------------------------------------------------------------------------

showTitle() {
    echo "=========================================================================="
    echo "|                    NST Utility Script (v$_scriptVer)                           |"
    echo "=========================================================================="
}

showHelp() {
    echo "=========================================================================="
    echo "|                    NST Utility Script (v$_scriptVer)                           |"
    echo "|                            Help Page                                   |"
    echo "=========================================================================="
    echo ""
    echo "  Available Switch Arguments: " 
    echo "--------------------------------------------------------------------------"
    echo "|  Default [No Arg]        | Runs the Full Installation Process          |"
    echo "|                          |                                             |"
    echo "|  [-f | -force]           | Forcefully Update Files/Service             |"
    echo "|                          |                                             |"
    echo "|  [-r | -remove | -clean] | Removes the Service and All NST files       |"
    echo "|                          | from the System                             |"
    echo "|                          |                                             |"
    echo "|  [-u | -update]          | Skip's Pre-req Install and downloads the    |"
    echo "|                          | last package file and updates the existing  |"
    echo "|                          | files and reinstalls the service            |"
    echo "|                          |                                             |"
    echo "--------------------------------------------------------------------------"
    exit
}

#   Checks to see if sudo should be used by default.  
#   It allows an argument of "true"/"false" to use sudo if it's allowed/supported on the machine
check_sudo() {
    _useSudo="false"
    if [ -x "$(command -v sudo)" ]; then
        if [ "$1" = "true" ]; then
            if [ $_currentUser != "root" ]; then
                _useSudo="true"
            fi
        fi
    fi
    #echo "Using Sudo: ($_useSudo)"
}

checkOwnerOk() {
    dir_owner="$(stat -c '%U' $_userDir)"
    if [ $_currentUser != $dir_owner ]; then
        return 1
    else 
        return 0
    fi
}

usedSudoDesc() {
    if $_useSudo; then
        return " | (SUDO)"
    else
        return ""
    fi
}

sudoPreCmd() {
    _cmd=$1
    if $_useSudo; then
        _cmd="sudo $_cmd"; $_cmd
    else
        $_cmd
    fi
}

#   Set current user as owner of apps working directory
set_owner() {
    echo ""
    echo "--------------------------------------------------------------"
    check_sudo "true"
    echo "Making ($_currentUser) Owner of directory [$_userDir]$usedSudoDesc"
    sudoPreCmd "chown -R $_currentUser:$_currentUser $_userDir"
    # verifies owner was set
    if [ ! checkOwnerOk ]; then
        echo "Error: Setting $_currentUser failed for Directory ($_userDir)"
        exit 1
    fi
}

#   This installs all pre-requisite APT Packages required by the service
install_prereqs() {
    echo ""
    echo "--------------------------------------------------------------"
    check_sudo "true"
    echo "Installing/Updating Required APT Packages$usedSudoDesc"
    sudoPreCmd "apt-get update"
    sudoPreCmd "apt-get upgrade -f -y --force-yes"
    if $_useSudo; then
        curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash -
    else
        curl -sL https://deb.nodesource.com/setup_7.x | bash -
    fi
    sudoPreCmd "apt-get install wget git-core unzip openssh-server nodejs build-essential -y"
}

getLatestPackage() {
    download_package
    if [ -f $app_zip_file ];
    then
        remove_old_srvc
        unzip_pkg
        #check_sudo # because set_owner changes the sudo allow to true
        echo "Changing to [$working_app_dir] directory..."
        cd $working_app_dir
        install_node_app
        update_srvc
        exit 0
    else
        echo "Error: NST Package Zip File ($app_zip_file) Not Found"
        echo "at ($_userDir)"
        exit 1
    fi
}

#   This Downloads the latest NST Streaming package from the distribution source and extracts it 
download_package() {
    if [ checkOwnerOk != "true" ]; then
        set_owner
    fi
    check_sudo
    echo ""
    echo "--------------------------------------------------------------------------"
    echo "Downloading the Latest NST-Streaming Package ($src_zip_name)$usedSudoDesc"
    echo "--------------------------------------------------------------------------"
    sudoPreCmd "wget -N $remote_file -P $_userDir"
}

unzip_pkg() {
    echo ""
    echo "--------------------------------------------------------------"
    check_sudo
    if [ -f $app_zip_file ];
    then
        cd $_userDir
        echo "Unzipping Latest NST Package to $working_app_dir$usedSudoDesc"
        sudoPreCmd "unzip -o $app_zip_file"
        set_owner
    else
        echo "Error: Unzip Failed because $app_zip_file can't be located"
        exit 1
    fi
}

install_node_app() {
    echo ""
    echo "--------------------------------------------------------------"
    check_sudo
    if [ -d $working_app_dir ]; then
        cd $working_app_dir
        echo "Running Node Service Install$usedSudoDesc"
        sudoPreCmd "npm install --no-optional"
    else
        echo "Error: Node App NPM Install Failed because the directory ($working_app_dir) wasn't found"
        exit 1
    fi
}

modify_srvc_file_for_user() {
    check_sudo
    #echo "New NST Streaming Service File found. Updating!!!"
    if [ $_currentUser != "pi" ];
    then
        echo "Modifying Service File with Current User Path [$_userDir]$usedSudoDesc"
        sudoPreCmd "sed -ia 's|/home/pi/nst-streaming-master|'$working_app_dir'|g' $cur_srvc_name"
    fi
}

remove_old_srvc() {
    echo ""
    echo "--------------------------------------------------------------"
    echo "Checking for Existing NST Streaming Service File"
    if [ -f $old_srvc_path ]; then
        check_sudo "true"
        echo "Result: Found Existing Service File..."
        echo "Disabling and Removing Existing NST Streaming Service$usedSudoDesc"
        sudoPreCmd "systemctl stop $old_srvc_name"
        sudoPreCmd "systemctl disable $old_srvc_name"
        sudoPreCmd "rm $old_srvc_path"
    else
        echo "Result: Nothing to Remove.  No Existing Service File Found"
    fi
}

update_srvc() {
    echo ""
    echo "--------------------------------------------------------------"
    if [ -f $new_srvc_src_path ]; then
        modify_srvc_file_for_user
    else
        echo "Error: New NST Service File ($new_srvc_src_path) Not Present."
        exit 1
    fi
    if [ ! -f "$old_srvc_path" ]; then
        check_sudo "true"
        echo "Copying Updated NST Streaming Service File to Systemd Folder$usedSudoDesc"
        sudoPreCmd "cp $new_srvc_src_path $new_srvc_dest_path -f"
        if [ -f $new_srvc_dest_path ]; then
            echo "Reloading Systemd Daemon to Reflect Service File Changes$usedSudoDesc"
            sudoPreCmd "systemctl daemon-reload"
            echo "Enabling NST Service (Systemd)$usedSudoDesc"
            sudoPreCmd "systemctl enable $cur_srvc_name"
            echo "Starting NST Streaming Service$usedSudoDesc"
            sudoPreCmd "systemctl start $cur_srvc_name"
        else
            echo "Error: Copying Service File to Systemd folder didn't work"
            exit 1
        fi
    else
        echo "Error: Can't Copy New Service because Old File is Still There!!"
        exit 1
    fi
}

pkg_cleanup() {
    check_sudo
    if [ -d $working_app_dir ]; then
        echo ""
        echo "----------------------------------------------------------------------"
        if [ checkOwnerOk != "true" ]; then
            set_owner
        fi
        echo "Removing All NST-Streaming Data and Files$usedSudoDesc"
        sudoPreCmd "rm -rf $working_app_dir"
        if [ -f $_userDir/$src_zip_name ]; then
            sudoPreCmd "rm -rf $_userDir/$src_zip_name"
        fi
    fi
}

remove_all() {
    remove_old_srvc
    pkg_cleanup
}

showPkgDlOk() {
    echo ""
    echo "=============================================================="
    echo "               Install/Update Result: (Success)               "
    echo "          New Data Downloaded and Service Installed           "
    echo "                                                              "
    echo "            View Service Logs Using this Command:             "
    echo "               journalctl -f -u nst-streaming                 "
    echo "=============================================================="
    echo ""
}

showCleanupOk() {
    echo ""
    echo "=============================================================="
    echo "              Cleanup/Removal Result: (Success)               "
    echo "          All NST-Streaming Data and Files Removed            "
    echo "=============================================================="
    echo ""
}

# echo "Executing Script $0 $1"
clear
if [ $# -eq 0 ]; then
    showTitle
    install_prereqs
    getLatestPackage
else
    if [ "$1" = "-r" ] || [ "$1" = "-remove" ] || [ "$1" = "-clean" ]; then
        showTitle
        remove_all
        showCleanupOk

    elif [ "$1" = "-f" ] || [ "$1" = "-force" ]; then
        showTitle
        remove_all
        getLatestPackage
        showPkgDlOk
        sudoPreCmd "journalctl -f -u nst-streaming"

    elif [ "$1" = "-u" ] || [ "$1" = "-update" ]; then
        showTitle
        getLatestPackage
        showPkgDlOk
        sudoPreCmd "journalctl -f -u nst-streaming" 

    elif [ "$1" = "-help" ] || [ "$1" = "-h" ] || [ "$1" = "-?" ] || [ "$1" != "-u" ] || [ "$1" != "-update" ] || [ "$1" != "-f" ] || [ "$1" != "-force" ] || [ "$1" != "-r" ] || [ "$1" != "-remove" ] || [ "$1" != "-clean" ]; then
        showHelp
    fi
fi
