#!/bin/bash
docker compose up .. -d --build
startTime=`date +%s`

status=`docker compose ps | grep server-1 | grep 'Up' | grep '(healthy)' | wc -l`
while [[ $status -ne 1 && `expr \`date +%s\` - $startTime` -lt 60 ]]; do
  sleep 1
  echo "Checking server status..."
  docker compose ps
  status=`docker compose ps | grep server-1 | grep 'Up' | grep '(healthy)' | wc -l`
done
if [[ $status -eq 1 ]]
then
    echo -e "\e[32mService started successfully.\e[0m"
	exitCode=0
else
    echo -e "\e[31mService failed to start.\e[0m"
	exitCode=1
fi
docker compose down --rmi local
exit $exitCode