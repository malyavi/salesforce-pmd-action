public with sharing class Smoke {
    public void one() {
        try {
            Integer i = 1 / 0;
        } catch (Exception e) {
        }
    }
}
