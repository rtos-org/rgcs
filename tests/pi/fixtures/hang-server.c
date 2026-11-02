/* A release that passes the installer's --version check, then accepts TCP on :8000 and never
 * answers (the case where an unbounded health check would hang and the running ELF is
 * text-busy). Built for aarch64 by scripts/build-pi.sh into dist/pi/hang-server. */
#include <netinet/in.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc > 1 && (strcmp(argv[1], "--version") == 0 || strcmp(argv[1], "-V") == 0)) {
    puts("rgcs-server 9.9.9 (hang)");
    return 0;
  }
  int s = socket(AF_INET, SOCK_STREAM, 0);
  int one = 1;
  setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  struct sockaddr_in a = {0};
  a.sin_family = AF_INET;
  a.sin_port = htons(8000);
  a.sin_addr.s_addr = htonl(INADDR_ANY);
  if (bind(s, (struct sockaddr *)&a, sizeof a) != 0 || listen(s, 16) != 0) return 1;
  for (;;) {
    int c = accept(s, NULL, NULL);
    (void)c; /* hold the connection, never reply */
  }
}
