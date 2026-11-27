-- Rights the local csk_hub user needs beyond its own database, for development only: the test
-- harness creates and drops csk_hub_test_* databases beside it, and the release image's migrate
-- command (and its test) creates the runtime user and grants it data access.
GRANT ALL PRIVILEGES ON `csk\_hub`.* TO 'csk_hub'@'%' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON `csk\_hub\_%`.* TO 'csk_hub'@'%' WITH GRANT OPTION;
GRANT CREATE USER ON *.* TO 'csk_hub'@'%';
FLUSH PRIVILEGES;
