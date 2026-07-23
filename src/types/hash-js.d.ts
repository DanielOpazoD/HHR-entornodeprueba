declare module 'hash.js' {
  interface HashInstance {
    update(value: Uint8Array): HashInstance;
    digest(): number[];
  }

  interface HashJs {
    sha384(): HashInstance;
  }

  const hashJs: HashJs;
  export default hashJs;
}
