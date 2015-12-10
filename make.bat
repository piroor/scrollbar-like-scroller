setlocal
set appname=scrollbar-like-scroller

copy makexpi\makexpi.sh .\
bash makexpi.sh -n %appname% -o
del makexpi.sh
endlocal
