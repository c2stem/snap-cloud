# Snap Cloud
This is an open source version of the cloud backend for [Snap!](https://github.com/jmoenig/Snap--Build-Your-Own-Blocks).

## Usage
First, install the server with `npm install -g c2stem/snap-cloud`. Then, ensure that an instance of MongoDB is running and start the server with:


```
    snap-cloud start
```

Additional commands for managing users and projects include:
```
    snap-cloud list-users
    snap-cloud list-projects
    snap-cloud delete-project <user> <project>
    snap-cloud add-user
    snap-cloud delete-user
    snap-cloud set-email <user> <email>
    snap-cloud set-password <user> <password>
```
